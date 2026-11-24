// Staff auth: Google sign-in restricted to @ALLOWED_DOMAIN.
// Sessions are stateless HMAC-signed tokens, sent either as an HttpOnly cookie
// (web app) or as a Bearer header (Missive sidebar, which stores the token
// with Missive.storeSet so it survives app reloads).

const crypto = require('crypto');
const express = require('express');
const { OAuth2Client } = require('google-auth-library');
const config = require('./config');
const db = require('./db');

const SESSION_DAYS = 60;
const googleClient = new OAuth2Client();

function b64url(buf) {
  return Buffer.from(buf).toString('base64url');
}
function sign(payload) {
  const body = b64url(JSON.stringify(payload));
  const mac = crypto.createHmac('sha256', config.sessionSecret).update(body).digest('base64url');
  return `${body}.${mac}`;
}
function verify(token) {
  if (!token || typeof token !== 'string' || !token.includes('.')) return null;
  const [body, mac] = token.split('.');
  const expected = crypto.createHmac('sha256', config.sessionSecret).update(body).digest('base64url');
  const a = Buffer.from(mac || '');
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    if (!payload.exp || payload.exp < Date.now()) return null;
    return payload;
  } catch {
    return null;
  }
}

function parseCookies(req) {
  const out = {};
  (req.headers.cookie || '').split(';').forEach((part) => {
    const i = part.indexOf('=');
    if (i > -1) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  });
  return out;
}

function issueToken(user) {
  return sign({ uid: user.id, exp: Date.now() + SESSION_DAYS * 864e5 });
}

// SameSite=None lets the session work when the app is loaded inside Missive's iframe.
// It requires Secure, which browsers allow on https and on http://localhost.
const crossSiteOk = /^https:|^http:\/\/localhost/.test(config.appUrl);
function setSessionCookie(res, token) {
  res.setHeader('Set-Cookie', [
    `sid=${token}; Path=/; HttpOnly; Max-Age=${SESSION_DAYS * 86400}; ${crossSiteOk ? 'SameSite=None; Secure' : 'SameSite=Lax'}`,
  ]);
}

async function upsertUser({ email, name, picture }) {
  return db.one(
    `INSERT INTO users(email, name, picture, last_seen_at) VALUES (lower($1), $2, $3, now())
     ON CONFLICT (email) DO UPDATE SET name = COALESCE(EXCLUDED.name, users.name),
       picture = COALESCE(EXCLUDED.picture, users.picture), last_seen_at = now()
     RETURNING *`,
    [email, name || null, picture || null]
  );
}

// Middleware: attaches req.user if signed in.
async function loadUser(req, _res, next) {
  try {
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : parseCookies(req).sid;
    const payload = verify(token);
    if (payload) req.user = await db.one('SELECT id, email, name, picture FROM users WHERE id = $1', [payload.uid]);
  } catch (e) {
    console.error('auth load error', e);
  }
  next();
}

function requireApi(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'Not signed in' });
  next();
}
function requirePage(req, res, next) {
  if (!req.user) return res.redirect(`/login?next=${encodeURIComponent(req.originalUrl)}`);
  next();
}

function emailAllowed(email) {
  return typeof email === 'string' && email.toLowerCase().endsWith(`@${config.allowedDomain}`);
}

const router = express.Router();

router.get('/auth/config', (_req, res) => {
  res.json({ googleClientId: config.googleClientId, devAuth: config.devAuth, domain: config.allowedDomain });
});

async function finishLogin(req, res, user) {
  const token = issueToken(user);
  setSessionCookie(res, token);
  // Missive handoff: the sidebar opened /login?handoff=<nonce> in a browser and is polling for this token.
  const nonce = req.body && req.body.handoff;
  if (nonce && /^[a-zA-Z0-9_-]{16,80}$/.test(nonce)) {
    await db.q(
      `INSERT INTO auth_handoffs(nonce, token) VALUES ($1, $2) ON CONFLICT (nonce) DO UPDATE SET token = EXCLUDED.token`,
      [nonce, token]
    );
  }
  res.json({ ok: true, token, user: { id: user.id, email: user.email, name: user.name } });
}

router.post('/auth/google', express.json(), async (req, res) => {
  try {
    if (!config.googleClientId) return res.status(500).json({ error: 'GOOGLE_CLIENT_ID is not set' });
    const ticket = await googleClient.verifyIdToken({ idToken: req.body.credential, audience: config.googleClientId });
    const p = ticket.getPayload();
    if (!p.email_verified || !emailAllowed(p.email)) {
      return res.status(403).json({ error: `Sign in with your @${config.allowedDomain} Google account.` });
    }
    const user = await upsertUser({ email: p.email, name: p.name, picture: p.picture });
    await finishLogin(req, res, user);
  } catch (e) {
    console.error('google auth error', e);
    res.status(401).json({ error: 'Google sign-in failed' });
  }
});

router.post('/auth/dev', express.json(), async (req, res) => {
  if (!config.devAuth) return res.status(404).end();
  const email = String(req.body.email || '').trim();
  if (!emailAllowed(email)) return res.status(403).json({ error: `Use an @${config.allowedDomain} email` });
  const name = email.split('@')[0].replace(/[._]/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
  const user = await upsertUser({ email, name });
  await finishLogin(req, res, user);
});

// Missive sidebar polls this after opening the login page in the browser.
router.get('/auth/handoff/:nonce', async (req, res) => {
  const row = await db.one(
    `DELETE FROM auth_handoffs WHERE nonce = $1 AND token IS NOT NULL AND created_at > now() - interval '15 minutes' RETURNING token`,
    [req.params.nonce]
  );
  res.json({ token: row ? row.token : null });
});

router.post('/auth/logout', (_req, res) => {
  res.setHeader('Set-Cookie', 'sid=; Path=/; Max-Age=0');
  res.json({ ok: true });
});

router.get('/api/me', loadUser, (req, res) => {
  res.json({ user: req.user || null });
});

// Clean up stale handoffs occasionally.
setInterval(() => db.q(`DELETE FROM auth_handoffs WHERE created_at < now() - interval '1 hour'`).catch(() => {}), 36e5).unref();

module.exports = { router, loadUser, requireApi, requirePage };

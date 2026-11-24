/**
 * Inkmule Proofing — art requests, proofs, and customer approvals.
 *
 *   /board, /requests/:id, /new, /settings   staff web app (Google sign-in)
 *   /missive                                 Missive sidebar app (same features, compact)
 *   /p/:token                                customer proof page (approve / request changes)
 */

const path = require('path');
const crypto = require('crypto');
const express = require('express');
const config = require('./src/config');
const db = require('./src/db');
const auth = require('./src/auth');
const ss = require('./src/ss');
const dropbox = require('./src/dropbox');

const app = express();
app.set('trust proxy', 1);
app.disable('x-powered-by');

const PUB = path.join(__dirname, 'public');
const page = (file) => (_req, res) => res.sendFile(path.join(PUB, file));

app.get('/health', (_req, res) => res.json({ status: 'ok' }));

app.use(auth.loadUser);
app.use(auth.router);
app.use(require('./src/routes/public'));
app.use(require('./src/routes/api'));

// Pages. Anything loaded inside an iframe (i.e. Missive) gets the sidebar app, whose sign-in
// doesn't depend on cookies — browsers often block cookies in embedded pages.
const inIframe = (req) => req.get('sec-fetch-dest') === 'iframe';
app.get(['/', '/board', '/new', '/settings', '/login'], (req, res, next) => {
  if (inIframe(req) && !req.query.handoff) return res.redirect('/missive');
  next();
});
app.get('/', (req, res) => res.redirect(req.user ? '/board' : '/login'));
app.get('/login', page('login.html'));
app.get('/board', auth.requirePage, page('board.html'));
app.get('/new', auth.requirePage, page('new.html'));
app.get('/requests/:id', auth.requirePage, page('request.html'));
app.get('/settings', auth.requirePage, page('settings.html'));
app.get('/missive', page('missive.html'));   // handles its own sign-in
app.get('/p/:token', page('proof.html'));    // public, token-gated

// Old prototype routes → new pages
app.get('/sales', (_req, res) => res.redirect('/new'));
app.get('/art', (_req, res) => res.redirect('/board'));

// One-time helper to get a Dropbox refresh token. Visit /setup/dropbox while signed in.
app.get('/setup/dropbox', auth.requirePage, (req, res) => {
  const { appKey, appSecret } = config.dropbox;
  if (!appKey || !appSecret) return res.status(400).send('Set DROPBOX_APP_KEY and DROPBOX_APP_SECRET first, then reload.');
  const state = crypto.randomBytes(12).toString('hex');
  res.setHeader('Set-Cookie', `dbx_state=${state}; Path=/setup; HttpOnly; Max-Age=600; SameSite=Lax`);
  const qs = new URLSearchParams({
    client_id: appKey, response_type: 'code', token_access_type: 'offline', state,
    redirect_uri: `${config.appUrl}/setup/dropbox/callback`,
  });
  res.redirect(`https://www.dropbox.com/oauth2/authorize?${qs}`);
});
app.get('/setup/dropbox/callback', auth.requirePage, async (req, res) => {
  try {
    const cookieState = (req.headers.cookie || '').match(/dbx_state=([a-f0-9]+)/);
    if (!cookieState || cookieState[1] !== req.query.state) return res.status(400).send('State mismatch, start again at /setup/dropbox');
    const r = await fetch('https://api.dropboxapi.com/oauth2/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code: req.query.code, grant_type: 'authorization_code', client_id: config.dropbox.appKey,
        client_secret: config.dropbox.appSecret, redirect_uri: `${config.appUrl}/setup/dropbox/callback`,
      }),
    });
    const data = await r.json();
    if (!data.refresh_token) return res.status(400).send(`Dropbox did not return a refresh token: ${JSON.stringify(data)}`);
    res.send(`<body style="font-family:system-ui;max-width:640px;margin:60px auto;line-height:1.5">
      <h2>Dropbox connected</h2><p>Add this as the <code>DROPBOX_REFRESH_TOKEN</code> variable in Railway, then redeploy:</p>
      <textarea readonly style="width:100%;height:90px;font-family:monospace">${data.refresh_token}</textarea>
      <p>Treat it like a password. You won't need to do this again.</p></body>`);
  } catch (e) {
    res.status(500).send(`Dropbox setup failed: ${e.message}`);
  }
});

// No long-term caching: browsers re-check files on each load (cheap, via ETag), so updates show up immediately.
app.use(express.static(PUB, { maxAge: 0, index: false }));

app.use((err, _req, res, _next) => {
  if (err && err.code === 'LIMIT_FILE_SIZE') return res.status(413).json({ error: `File is too big (max ${config.maxFileMb} MB).` });
  console.error(err);
  res.status(500).json({ error: 'Server error' });
});

(async () => {
  const problems = [];
  if (!process.env.DATABASE_URL) problems.push('DATABASE_URL is not set. In Railway: app service → Variables → New Variable → DATABASE_URL = ${{Postgres.DATABASE_URL}}');
  if (config.isProd && config.sessionSecret === 'dev-only-secret-change-me') problems.push('SESSION_SECRET is not set. Add any long random string as SESSION_SECRET in Variables.');
  if (problems.length) {
    console.error('\n*** CONFIG PROBLEM ***\n- ' + problems.join('\n- ') + '\n');
    process.exit(1);
  }
  // Postgres can still be starting on first deploy — retry for ~45s before giving up.
  for (let attempt = 1; ; attempt++) {
    try {
      await db.migrate();
      break;
    } catch (e) {
      console.error(`Database not ready (attempt ${attempt}/15): ${e.message}`);
      if (attempt >= 15) throw e;
      await new Promise((r) => setTimeout(r, 3000));
    }
  }
  ss.startDailyRefresh();
  app.listen(config.port, () => {
    console.log(`Inkmule Proofing on :${config.port}`);
    console.log(`  Dropbox: ${dropbox.enabled() ? `on (${config.dropbox.projectsRoot})` : 'OFF — files saved locally'}`);
    console.log(`  S&S: ${ss.enabled() ? 'on' : 'off'} | Email: ${config.email.resendApiKey ? 'on' : 'console only'} | Missive posts: ${config.missive.apiToken ? 'on' : 'console only'}`);
    console.log(`  Google sign-in: ${config.googleClientId ? 'on' : 'NOT CONFIGURED'}${config.devAuth ? ' | DEV_AUTH enabled' : ''}`);
  });
})().catch((e) => {
  console.error('Startup failed:', e);
  process.exit(1);
});

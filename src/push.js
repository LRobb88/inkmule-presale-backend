// Browser push notifications (show up as normal macOS notifications from
// Chrome, Safari, or a Safari "Add to Dock" web app).
// VAPID keys are generated once and stored in the database — no setup needed.

const webpush = require('web-push');
const config = require('./config');
const db = require('./db');

const EVENTS = [
  { key: 'new_request', label: 'A new art request is submitted', def: true },
  { key: 'sales_review', label: 'An artist asks me for sales review', def: true },
  { key: 'review_decision', label: 'Sales clears or sends back my proof', def: true },
  { key: 'client_response', label: 'A client approves or requests changes on my job', def: true },
  { key: 'client_viewed', label: 'A client opens the proof on my job', def: false },
  { key: 'comment', label: 'Someone comments on my job', def: true },
];
const DEFAULT_PREFS = Object.fromEntries(EVENTS.map((e) => [e.key, e.def]));

let ready = null;
function init() {
  if (!ready) {
    ready = (async () => {
      let keys = await db.getSetting('vapid', null);
      if (!keys) {
        keys = webpush.generateVAPIDKeys();
        await db.setSetting('vapid', keys);
      }
      const contact = `mailto:${config.email.from || 'proofs@inkmule.com'}`;
      webpush.setVapidDetails(contact, keys.publicKey, keys.privateKey);
      return keys;
    })();
  }
  return ready;
}

async function publicKey() {
  return (await init()).publicKey;
}

const prefsOf = (u) => ({ ...DEFAULT_PREFS, ...(u.notify_prefs || {}) });

// Send to the given users (ids, or 'all'), respecting each person's preferences.
async function notify(userIds, event, { title, body, url, excludeUserId, force } = {}) {
  try {
    await init();
    const ids = userIds === 'all'
      ? (await db.q('SELECT id FROM users')).map((u) => u.id)
      : [...new Set((userIds || []).filter(Boolean))];
    const targets = ids.filter((id) => id !== excludeUserId);
    if (!targets.length) return;
    const users = await db.q('SELECT id, notify_prefs FROM users WHERE id = ANY($1::int[])', [targets]);
    const allowed = users.filter((u) => force || prefsOf(u)[event]).map((u) => u.id);
    if (!allowed.length) return;
    const subs = await db.q('SELECT * FROM push_subscriptions WHERE user_id = ANY($1::int[])', [allowed]);
    const payload = JSON.stringify({ title, body, url: url || config.appUrl, tag: `${event}-${url || ''}` });
    await Promise.all(subs.map(async (s) => {
      try {
        await webpush.sendNotification({ endpoint: s.endpoint, keys: s.keys }, payload, { TTL: 60 * 60 * 24 });
      } catch (e) {
        if (e.statusCode === 404 || e.statusCode === 410) {
          await db.q('DELETE FROM push_subscriptions WHERE id = $1', [s.id]); // browser unsubscribed
        } else {
          console.error('push failed', e.statusCode || '', e.message);
        }
      }
    }));
  } catch (e) {
    console.error('push notify error', e.message);
  }
}

module.exports = { EVENTS, DEFAULT_PREFS, publicKey, notify, prefsOf };

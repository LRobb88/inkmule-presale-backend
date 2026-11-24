// Board columns are configurable in Settings: rename, reorder, add, remove.
// Automatic moves are mapped from workflow events to a column (or "stay put").

const db = require('./db');

const DEFAULT_COLUMNS = [
  { key: 'new', label: 'New', color: '#8a8f90' },
  { key: 'changes_requested', label: 'Changes Requested', color: '#c0392b' },
  { key: 'sent', label: 'Sent', color: '#7a5bd6' },
  { key: 'archive', label: 'Archive', color: '#5b6162', archive: true },
];

// Workflow events that can move a card. '' = leave the card where it is.
const EVENTS = [
  { key: 'created', label: 'A new request is submitted', def: 'new' },
  { key: 'ready', label: 'A proof is added and ready to send (or sales sends one back)', def: '' },
  { key: 'sales_review', label: 'A proof goes to sales review', def: '' },
  { key: 'sent', label: 'Proofs are sent to the client (email or live link)', def: 'sent' },
  { key: 'changes', label: 'The client requests changes', def: 'changes_requested' },
  { key: 'approved', label: 'Every product is approved', def: 'archive' },
];
const DEFAULT_AUTOMATION = Object.fromEntries(EVENTS.map((e) => [e.key, e.def]));

// Old fixed statuses → new default columns (one-time migration).
const LEGACY_MAP = {
  new: 'new', in_progress: 'new', sales_review: 'new', proof_sent: 'sent',
  changes_requested: 'changes_requested', approved: 'archive', done: 'archive',
};

async function migrate() {
  const existing = await db.one(`SELECT value FROM settings WHERE key = 'columns'`);
  if (existing) return;
  await db.setSetting('columns', DEFAULT_COLUMNS);
  await db.setSetting('automation', DEFAULT_AUTOMATION);
  for (const [from, to] of Object.entries(LEGACY_MAP)) {
    await db.q('UPDATE requests SET status = $2 WHERE status = $1', [from, to]);
  }
}

async function getColumns() {
  return db.getSetting('columns', DEFAULT_COLUMNS);
}
async function getAutomation() {
  const a = await db.getSetting('automation', DEFAULT_AUTOMATION);
  return { ...DEFAULT_AUTOMATION, ...a };
}

const slug = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 40) || 'column';

async function saveColumns(input, automationIn) {
  if (!Array.isArray(input) || !input.length) throw new Error('Keep at least one column.');
  const used = new Set();
  const columns = input.map((c) => {
    const label = String(c.label || '').trim().slice(0, 40);
    if (!label) throw new Error('Every column needs a name.');
    let key = c.key && /^[a-z0-9_]{1,40}$/.test(c.key) ? c.key : slug(label);
    while (used.has(key)) key = `${key}_2`;
    used.add(key);
    return { key, label, color: /^#[0-9a-f]{6}$/i.test(c.color || '') ? c.color : '#8a8f90', archive: Boolean(c.archive) };
  });
  const keys = columns.map((c) => c.key);
  const automation = {};
  for (const e of EVENTS) {
    const v = automationIn && automationIn[e.key];
    automation[e.key] = v && keys.includes(v) ? v : '';
  }
  if (!automation.created) automation.created = keys[0];
  await db.setSetting('columns', columns);
  await db.setSetting('automation', automation);
  // Cards in removed columns move to the first column.
  await db.q('UPDATE requests SET status = $1 WHERE NOT (status = ANY($2::text[]))', [keys[0], keys]);
  return { columns, automation };
}

module.exports = { DEFAULT_COLUMNS, EVENTS, DEFAULT_AUTOMATION, migrate, getColumns, getAutomation, saveColumns };

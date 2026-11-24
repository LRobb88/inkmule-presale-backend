const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');
const config = require('./config');

const needsSsl = /railway|rlwy|amazonaws|render\.com|supabase|neon/.test(config.databaseUrl) && !/localhost|127\.0\.0\.1|\.internal/.test(config.databaseUrl);
const pool = new Pool({
  connectionString: config.databaseUrl,
  ssl: needsSsl ? { rejectUnauthorized: false } : undefined,
});

async function q(text, params) {
  const res = await pool.query(text, params);
  return res.rows;
}
async function one(text, params) {
  const rows = await q(text, params);
  return rows[0] || null;
}
async function tx(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn({
      q: async (t, p) => (await client.query(t, p)).rows,
      one: async (t, p) => (await client.query(t, p)).rows[0] || null,
    });
    await client.query('COMMIT');
    return result;
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

const DEFAULT_WARNINGS = [
  { key: 'low_res', text: 'Artwork is low resolution and may print soft or pixelated.' },
  { key: 'fine_detail', text: 'Fine lines or small text may not hold at this print size.' },
  { key: 'screen_color', text: 'On-screen colors are approximate; ink will not exactly match your screen.' },
  { key: 'garment_color', text: 'Ink color will look different on this garment color.' },
  { key: 'placement', text: 'Print size and placement on the mockup are approximate.' },
  { key: 'halftones', text: 'Gradients or photos will be converted to halftones.' },
  { key: 'embroidery', text: 'Embroidery will simplify small details and text.' },
  { key: 'spelling', text: 'Please check all spelling. We print exactly what you approve.' },
];

async function migrate() {
  const sql = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
  await pool.query(sql);
  await pool.query(
    `INSERT INTO settings(key, value) VALUES ('warnings', $1) ON CONFLICT (key) DO NOTHING`,
    [JSON.stringify(DEFAULT_WARNINGS)]
  );
  await require('./columns').migrate();
}

async function getSetting(key, fallback) {
  const row = await one('SELECT value FROM settings WHERE key = $1', [key]);
  return row ? row.value : fallback;
}
async function setSetting(key, value) {
  await q(
    `INSERT INTO settings(key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
    [key, JSON.stringify(value)]
  );
}

module.exports = { pool, q, one, tx, migrate, getSetting, setSetting, DEFAULT_WARNINGS };

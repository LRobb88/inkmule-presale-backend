// S&S Activewear integration.
// - The full style list is cached in Postgres and refreshed daily, so
//   autocomplete is instant and doesn't hit S&S on every keystroke.
// - Colors/images for a style are fetched on demand and cached in memory.

const config = require('./config');
const db = require('./db');

const cfg = config.ss;
const enabled = () => Boolean(cfg.account && cfg.apiKey);
const colorCache = new Map(); // styleId -> { at, data }

async function ssGet(pathAndQuery) {
  const auth = Buffer.from(`${cfg.account}:${cfg.apiKey}`).toString('base64');
  const res = await fetch(`${cfg.baseUrl}${pathAndQuery}`, { headers: { Authorization: `Basic ${auth}`, Accept: 'application/json' } });
  if (res.status === 404) return [];
  if (!res.ok) throw new Error(`S&S ${pathAndQuery} failed (${res.status}): ${(await res.text()).slice(0, 200)}`);
  return res.json();
}

const img = (p) => (p ? (/^https?:/.test(p) ? p : cfg.imageBase + String(p).replace(/^\//, '')) : null);

function brandSlug(brand) {
  return String(brand || '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
}
function productUrl(style) {
  return cfg.productUrlTemplate
    .replace('{brandSlug}', encodeURIComponent(brandSlug(style.brand_name)))
    .replace('{styleName}', encodeURIComponent(String(style.style_name || '').toLowerCase()))
    .replace('{partNumber}', encodeURIComponent(style.part_number || ''));
}

async function refreshStyles({ force } = {}) {
  if (!enabled()) return { skipped: 'not configured' };
  if (!force) {
    const row = await db.one('SELECT max(updated_at) AS at, count(*)::int AS n FROM ss_styles');
    if (row && row.n > 0 && row.at && Date.now() - new Date(row.at).getTime() < 20 * 36e5) return { skipped: 'fresh', count: row.n };
  }
  const styles = await ssGet('/styles/?fields=styleID,partNumber,brandName,styleName,title,baseCategory,styleImage');
  const chunk = 500;
  for (let i = 0; i < styles.length; i += chunk) {
    const part = styles.slice(i, i + chunk);
    const values = [];
    const params = [];
    part.forEach((s, j) => {
      const b = j * 8;
      values.push(`($${b + 1},$${b + 2},$${b + 3},$${b + 4},$${b + 5},$${b + 6},$${b + 7},$${b + 8},now())`);
      params.push(
        s.styleID, s.partNumber, s.brandName, s.styleName, s.title, s.baseCategory, s.styleImage,
        `${s.brandName} ${s.styleName} ${s.partNumber} ${s.title}`.toLowerCase()
      );
    });
    await db.q(
      `INSERT INTO ss_styles(style_id, part_number, brand_name, style_name, title, base_category, style_image, search_text, updated_at)
       VALUES ${values.join(',')}
       ON CONFLICT (style_id) DO UPDATE SET part_number=EXCLUDED.part_number, brand_name=EXCLUDED.brand_name,
         style_name=EXCLUDED.style_name, title=EXCLUDED.title, base_category=EXCLUDED.base_category,
         style_image=EXCLUDED.style_image, search_text=EXCLUDED.search_text, updated_at=now()`,
      params
    );
  }
  console.log(`S&S styles refreshed: ${styles.length}`);
  return { count: styles.length };
}

async function searchStyles(query) {
  const terms = String(query || '').toLowerCase().split(/\s+/).filter(Boolean).slice(0, 5);
  if (!terms.length) return [];
  const where = terms.map((_, i) => `search_text LIKE $${i + 1}`).join(' AND ');
  const params = terms.map((t) => `%${t.replace(/[%_]/g, '')}%`);
  const exact = terms.join(' ');
  params.push(exact);
  const rows = await db.q(
    `SELECT * FROM ss_styles WHERE ${where}
     ORDER BY (lower(style_name) = $${params.length}) DESC,
              (lower(brand_name || ' ' || style_name) = $${params.length}) DESC,
              length(style_name), brand_name
     LIMIT 15`,
    params
  );
  return rows.map(formatStyle);
}

function formatStyle(s) {
  return {
    styleId: s.style_id,
    brand: s.brand_name,
    style: s.style_name,
    partNumber: s.part_number,
    title: s.title,
    category: s.base_category,
    image: img(s.style_image),
    vendorUrl: productUrl(s),
  };
}

async function getStyle(styleId) {
  const s = await db.one('SELECT * FROM ss_styles WHERE style_id = $1', [styleId]);
  return s ? formatStyle(s) : null;
}

async function getColors(styleId) {
  const hit = colorCache.get(styleId);
  if (hit && Date.now() - hit.at < 12 * 36e5) return hit.data;
  const products = await ssGet(`/products/?styleid=${encodeURIComponent(styleId)}`);
  const byColor = new Map();
  for (const p of products) {
    if (!p.colorName || byColor.has(p.colorName)) continue;
    byColor.set(p.colorName, {
      name: p.colorName,
      code: p.colorCode || null,
      hex: p.color1 || null,
      swatch: img(p.colorSwatchImage),
      front: img(p.colorFrontImage),
      back: img(p.colorBackImage),
    });
  }
  const data = [...byColor.values()].sort((a, b) => a.name.localeCompare(b.name));
  colorCache.set(styleId, { at: Date.now(), data });
  return data;
}

function startDailyRefresh() {
  if (!enabled()) return;
  const run = () => refreshStyles().catch((e) => console.error('S&S refresh failed:', e.message));
  setTimeout(run, 5_000).unref();
  setInterval(run, 6 * 36e5).unref(); // checks every 6h, refreshes when >20h old
}

// Map S&S categories onto the form's product types.
function guessProductType(category, title) {
  const t = `${category || ''} ${title || ''}`.toLowerCase();
  if (/hood/.test(t)) return 'Hoodie';
  if (/crew|sweatshirt|fleece/.test(t)) return 'Sweatshirt';
  if (/long sleeve/.test(t)) return 'Long Sleeve';
  if (/tank/.test(t)) return 'Tank Top';
  if (/polo/.test(t)) return 'Polo';
  if (/hat|cap|beanie|headwear/.test(t)) return 'Hat / Cap';
  if (/tote|bag/.test(t)) return 'Tote Bag';
  if (/t-shirt|tee|t shirt/.test(t)) return 'T-Shirt';
  return 'Other';
}

module.exports = { enabled, refreshStyles, searchStyles, getStyle, getColors, startDailyRefresh, guessProductType };

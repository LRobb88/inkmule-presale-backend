// Staff API (web app + Missive sidebar). All routes require sign-in.

const express = require('express');
const multer = require('multer');
const config = require('../config');
const db = require('../db');
const dropbox = require('../dropbox');
const ss = require('../ss');
const notify = require('../notify');
const wf = require('../workflow');
const { requireApi } = require('../auth');
const cols = require('../columns');
const push = require('../push');
const proofFiles = require('../proofFiles');

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: config.maxFileMb * 1024 * 1024, files: 20 } });

router.use('/api', (req, res, next) => (req.path === '/me' ? next() : requireApi(req, res, next)));

const wrap = (fn) => (req, res) =>
  Promise.resolve(fn(req, res)).catch((e) => {
    console.error(`${req.method} ${req.originalUrl}`, e);
    res.status(e.status || 500).json({ error: e.expose ? e.message : `Something went wrong: ${e.message}` });
  });
const fail = (status, message) => Object.assign(new Error(message), { status, expose: true });

const PRODUCT_TYPES = ['T-Shirt', 'Long Sleeve', 'Hoodie', 'Sweatshirt', 'Tank Top', 'Polo', 'Hat / Cap', 'Tote Bag', 'Koozie', 'Sticker', 'Banner / Sign', 'Mug / Drinkware', 'Other'];
const DECORATION_TYPES = ['Screen Print', 'DTG', 'DTF', 'Embroidery', 'Other'];
const SP_OPTIONS = ['Bright Print', 'Vintage Print', 'White as Base'];
// Decorator choices per decoration type. 'Other' in a list prompts for a name.
// Decoration types not listed (DTG, DTF) have no decorator field; decoration "Other" asks for free text.
const DECORATORS = {
  'Screen Print': ['Purple Monkey', 'TeesNThings', 'Sharprint', 'Other'],
  'Embroidery': ['Murry West', 'TeesNThings', 'Purple Monkey', 'Sharprint', 'STLCE'],
};
// Ad-hoc design requests: one "work" item instead of product specs.
const DESIGN_TYPES = ['Mockup', 'Graphic design', 'Vector redraw / cleanup', 'Other'];
function designItem(data) {
  const type = String(data.work_type || '').trim();
  if (!type) throw fail(400, 'Choose the type of work.');
  return {
    sort: 0, source: 'design', product_type: type.slice(0, 60), brand: '', style: '', title: '',
    color_name: '', color_hex: null, swatch_url: null, image_url: null, back_image_url: null, vendor_url: '',
    ss_style_id: null, decoration_type: '', decorator: null, sp_options: [], locations: [],
    print_colors: '', item_notes: String(data.product_context || '').trim().slice(0, 2000),
  };
}
const LOCATIONS = ['Left Chest', 'Full Front', 'Back Center', 'Full Back', 'Left Sleeve', 'Right Sleeve', 'Nape / Tag', 'Other'];
const isEmail = (s) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(s || '').trim());

// ---------- Reference data ----------
router.get('/api/meta', wrap(async (_req, res) => {
  const [users, warnings] = await Promise.all([
    db.q('SELECT id, email, name, picture FROM users ORDER BY name NULLS LAST, email'),
    db.getSetting('warnings', db.DEFAULT_WARNINGS),
  ]);
  res.json({
    statuses: await cols.getColumns(), automation: await cols.getAutomation(), automationEvents: cols.EVENTS, users, warnings,
    options: { designTypes: DESIGN_TYPES, productTypes: PRODUCT_TYPES, decorationTypes: DECORATION_TYPES, spOptions: SP_OPTIONS, locations: LOCATIONS, decorators: DECORATORS },
    integrations: {
      dropbox: dropbox.enabled(), ss: ss.enabled(), email: Boolean(config.email.resendApiKey), missive: Boolean(config.missive.apiToken),
    },
  });
}));

router.put('/api/settings/columns', express.json(), wrap(async (req, res) => {
  try {
    res.json(await cols.saveColumns(req.body.columns, req.body.automation));
  } catch (e) {
    throw fail(400, e.message);
  }
}));

router.put('/api/settings/warnings', express.json(), wrap(async (req, res) => {
  const list = Array.isArray(req.body.warnings) ? req.body.warnings : [];
  const clean = list
    .map((w, i) => ({ key: String(w.key || `w${Date.now()}_${i}`).slice(0, 60), text: String(w.text || '').trim().slice(0, 300) }))
    .filter((w) => w.text);
  await db.setSetting('warnings', clean);
  res.json({ warnings: clean });
}));

// ---------- S&S ----------
router.get('/api/ss/search', wrap(async (req, res) => {
  if (!ss.enabled()) return res.json({ enabled: false, results: [] });
  res.json({ enabled: true, results: await ss.searchStyles(req.query.q) });
}));
router.get('/api/ss/styles/:id/colors', wrap(async (req, res) => {
  if (!ss.enabled()) return res.json({ colors: [] });
  res.json({ colors: await ss.getColors(parseInt(req.params.id, 10)) });
}));
router.post('/api/ss/refresh', wrap(async (_req, res) => res.json(await ss.refreshStyles({ force: true }))));

// ---------- Requests ----------
router.get('/api/requests', wrap(async (req, res) => {
  res.json({
    requests: await wf.listRequests({
      status: req.query.status, q: req.query.q, conversationId: req.query.conversation, includeDone: req.query.all === '1',
    }),
  });
}));

router.get('/api/requests/check-name', wrap(async (req, res) => {
  const row = await db.one('SELECT id FROM requests WHERE job_key = $1', [wf.jobKey(req.query.name)]);
  res.json({ available: !row, existingId: row ? row.id : null, folder: dropbox.jobFolder(req.query.name || '') });
}));

// Garment fields (the product's first garment lives on the item; extras in item.garments).
function cleanGarment(g, label) {
  const out = {
    source: g.source === 'ss' ? 'ss' : 'manual',
    product_type: String(g.product_type || '').trim(),
    brand: String(g.brand || '').trim(),
    style: String(g.style || '').trim(),
    title: String(g.title || '').trim(),
    color_name: String(g.color_name || '').trim(),
    color_hex: g.color_hex ? String(g.color_hex).slice(0, 20) : null,
    swatch_url: g.swatch_url || null,
    image_url: g.image_url || null,
    back_image_url: g.back_image_url || null,
    vendor_url: String(g.vendor_url || '').trim(),
    ss_style_id: g.ss_style_id ? parseInt(g.ss_style_id, 10) : null,
    colors: (Array.isArray(g.colors) ? g.colors : []).slice(0, 60).map((c) => ({
      name: String(c.name || '').slice(0, 60), hex: c.hex ? String(c.hex).slice(0, 20) : null,
      swatch: /^https?:\/\//.test(c.swatch || '') ? c.swatch : null, front: /^https?:\/\//.test(c.front || '') ? c.front : null,
      back: /^https?:\/\//.test(c.back || '') ? c.back : null,
    })).filter((c) => c.name),
  };
  if (!out.product_type) throw fail(400, `${label}: choose a product type.`);
  if (!out.style && !out.title) throw fail(400, `${label}: enter the brand/style.`);
  if (!out.color_name) throw fail(400, `${label}: enter the garment color.`);
  if (!/^https?:\/\//i.test(out.vendor_url)) throw fail(400, `${label}: add the vendor product link.`);
  return out;
}

function cleanItems(items) {
  if (!Array.isArray(items) || !items.length) throw fail(400, 'Add at least one product.');
  return items.map((it, i) => {
    const n = `Product ${i + 1}`;
    const item = {
      sort: i,
      ...cleanGarment(it, n),
      subname: String(it.subname || '').replace(/[\\/:*?"<>|]/g, '').trim().slice(0, 40) || null,
      garments: (Array.isArray(it.garments) ? it.garments : []).slice(0, 10).map((g, k) => cleanGarment(g, `${n}, garment ${k + 2}`)),
      decoration_type: String(it.decoration_type || '').trim(),
      decorator: String(it.decorator || '').trim().slice(0, 80) || null,
      sp_options: (Array.isArray(it.sp_options) ? it.sp_options : []).filter((x) => SP_OPTIONS.includes(x)),
      locations: (Array.isArray(it.locations) ? it.locations : []).map(String).filter(Boolean).slice(0, 12),
      print_colors: String(it.print_colors || '').trim(),
      item_notes: String(it.item_notes || '').trim(),
    };
    if (!item.decoration_type) throw fail(400, `${n}: choose a decoration type.`);
    const needsDecorator = DECORATORS[item.decoration_type] || item.decoration_type === 'Other';
    if (!needsDecorator) item.decorator = null;
    else if (!item.decorator || item.decorator === 'Other') throw fail(400, `${n}: choose the decorator.`);
    if (!item.locations.length) throw fail(400, `${n}: choose at least one print location.`);
    return item;
  });
}

async function insertItems(t, requestId, items) {
  const ids = [];
  for (const it of items) {
    const row = await t.one(
      `INSERT INTO request_items(request_id, sort, source, product_type, brand, style, title, color_name, color_hex, swatch_url,
         image_url, back_image_url, vendor_url, ss_style_id, decoration_type, sp_options, locations, print_colors, item_notes, decorator, colors, garments, subname)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23) RETURNING id`,
      [requestId, it.sort, it.source, it.product_type, it.brand, it.style, it.title, it.color_name, it.color_hex, it.swatch_url,
        it.image_url, it.back_image_url, it.vendor_url, it.ss_style_id, it.decoration_type, it.sp_options, it.locations, it.print_colors, it.item_notes, it.decorator, JSON.stringify(it.colors || []), JSON.stringify(it.garments || []), it.subname || null]
    );
    ids.push(row.id);
  }
  return ids;
}

async function saveArtwork(request, files, userId, itemId = null) {
  const saved = [];
  if (!files || !files.length) return saved;
  const folder = await dropbox.ensureFolder(request.dropbox_folder || dropbox.jobFolder(request.job_name));
  for (const f of files) {
    const stored = await dropbox.upload(folder, f.originalname, f.buffer);
    saved.push(await db.one(
      `INSERT INTO files(request_id, kind, name, dropbox_path, local_path, size, mime, created_by, item_id)
       VALUES ($1,'artwork',$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
      [request.id, f.originalname, stored.dropbox_path || null, stored.local_path || null, f.size, f.mimetype, userId, itemId]
    ));
  }
  return saved;
}

router.post('/api/requests', upload.any(), wrap(async (req, res) => {
  let data;
  try { data = JSON.parse(req.body.data || '{}'); } catch { throw fail(400, 'Bad form data'); }
  const jobName = String(data.job_name || '').trim();
  const kind = data.kind === 'design' ? 'design' : 'proof';
  if (!jobName) throw fail(400, kind === 'design' ? 'Give the request a name.' : 'Enter the job name.');
  if (kind === 'proof' && !isEmail(data.client_email)) throw fail(400, 'Enter a valid client email.');
  if (kind === 'design' && data.client_email && !isEmail(data.client_email)) throw fail(400, 'That client email looks wrong.');
  if (kind === 'design' && !String(data.notes || '').trim()) throw fail(400, 'Describe what you need.');
  const cc = String(data.cc_emails || '').split(/[,;\s]+/).filter(Boolean);
  if (cc.some((e) => !isEmail(e))) throw fail(400, 'One of the CC emails looks wrong.');
  const items = kind === 'design' ? [designItem(data)] : cleanItems(data.items);
  const key = wf.jobKey(jobName);
  if (await db.one('SELECT 1 FROM requests WHERE job_key = $1', [key])) {
    throw fail(409, `There's already a request named "${jobName}". Job names must be unique (they're the Dropbox folder name).`);
  }

  const folder = dropbox.jobFolder(jobName);
  let itemIds = [];
  const startCol = (await cols.getAutomation()).created || (await cols.getColumns())[0].key;
  const request = await db.tx(async (t) => {
    const min = await t.one(`SELECT COALESCE(min(position), 0) - 1 AS p FROM requests WHERE status = $1`, [startCol]);
    const r = await t.one(
      `INSERT INTO requests(job_name, job_key, client_name, client_company, client_email, cc_emails, rep_id, artist_id,
         status, position, due_date, notes, missive_conversation_id, missive_subject, dropbox_folder, public_token, kind)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$16,$9,$10,$11,$12,$13,$14,$15,$17) RETURNING *`,
      [jobName, key, data.client_name || null, data.client_company || null, String(data.client_email || '').trim() || null, cc.join(', ') || null,
        req.user.id, data.artist_id || null, min.p, data.due_date || null, data.notes || null,
        data.missive_conversation_id || null, data.missive_subject || null, folder, wf.newToken(), startCol, kind]
    );
    itemIds = await insertItems(t, r.id, items);
    return r;
  });
  await wf.log(request.id, { userId: req.user.id, kind: 'system', body: 'Created the request' });

  try {
    await dropbox.ensureFolder(folder);
    // Field "artwork" = whole job; "artwork_item_<index>" = a specific product.
    const files = req.files || [];
    await saveArtwork(request, files.filter((f) => f.fieldname === 'artwork'), req.user.id);
    for (let i = 0; i < itemIds.length; i++) {
      await saveArtwork(request, files.filter((f) => f.fieldname === `artwork_item_${i}`), req.user.id, itemIds[i]);
    }
  } catch (e) {
    console.error('Dropbox error on create:', e);
    await wf.log(request.id, { actor: 'System', kind: 'system', body: `Dropbox problem saving artwork: ${e.message}` });
  }
  push.notify('all', 'new_request', {
    title: `New ${kind === 'design' ? 'design' : 'art'} request: ${jobName}`,
    body: `${req.user.name || req.user.email} · ${items.map((it) => wf.itemLabel(it)).join(', ')}`,
    url: wf.appRequestUrl(request), excludeUserId: req.user.id,
  });
  if (request.missive_conversation_id) {
    notify.missivePost(request.missive_conversation_id, {
      title: 'Art request created',
      body: `${req.user.name || req.user.email} created art request "${jobName}"`,
      markdown: `🎨 **Art request created:** [${jobName}](${wf.appRequestUrl(request)}) by ${req.user.name || req.user.email}`,
    });
  }
  res.status(201).json({ request: await wf.loadDetail(request.id) });
}));

router.get('/api/requests/:id', wrap(async (req, res) => {
  const r = await wf.loadDetail(parseInt(req.params.id, 10));
  if (!r) throw fail(404, 'Not found');
  res.json({ request: r });
}));

async function getRequest(id) {
  const r = await db.one('SELECT * FROM requests WHERE id = $1', [parseInt(id, 10)]);
  if (!r) throw fail(404, 'Request not found');
  return r;
}

const EDITABLE = ['client_name', 'client_company', 'client_email', 'cc_emails', 'due_date', 'notes', 'artist_id', 'rep_id', 'missive_conversation_id'];
router.patch('/api/requests/:id', express.json(), wrap(async (req, res) => {
  let r = await getRequest(req.params.id);
  if (typeof req.body.job_name === 'string' && req.body.job_name.trim() && req.body.job_name.trim() !== r.job_name) {
    const name = req.body.job_name.trim();
    const key = wf.jobKey(name);
    const clash = await db.one('SELECT id FROM requests WHERE job_key = $1 AND id <> $2', [key, r.id]);
    if (clash) throw fail(409, `There's already a request named "${name}".`);
    const oldFolder = r.dropbox_folder || dropbox.jobFolder(r.job_name);
    const newFolder = dropbox.jobFolder(name);
    if (newFolder.toLowerCase() !== oldFolder.toLowerCase()) {
      try { await dropbox.moveFolder(oldFolder, newFolder); }
      catch (e) { throw fail(409, `Couldn't rename the Dropbox folder: ${e.message}`); }
    }
    await db.tx(async (t) => {
      await t.q('UPDATE requests SET job_name = $2, job_key = $3, dropbox_folder = $4, updated_at = now() WHERE id = $1', [r.id, name, key, newFolder]);
      // Keep stored file paths pointing at the renamed folder.
      await t.q(`UPDATE files SET dropbox_path = $3 || substr(dropbox_path, length($2) + 1)
                 WHERE request_id = $1 AND lower(dropbox_path) LIKE lower($2) || '/%'`, [r.id, oldFolder, newFolder]);
      await t.q(`UPDATE files SET local_path = $3 || substr(local_path, length($2) + 1)
                 WHERE request_id = $1 AND local_path LIKE $2 || '/%'`, [r.id, oldFolder.replace(/^\//, ''), newFolder.replace(/^\//, '')]);
    });
    await wf.log(r.id, { userId: req.user.id, kind: 'system', body: `Renamed the job from "${r.job_name}" to "${name}" (Dropbox folder renamed too)` });
    r = await getRequest(r.id);
  }
  const sets = [];
  const params = [r.id];
  for (const k of EDITABLE) {
    if (k in req.body) {
      let v = req.body[k];
      if (v === '') v = null;
      if (k === 'client_email' && !isEmail(v) && !(r.kind === 'design' && !v)) throw fail(400, 'Enter a valid client email.');
      params.push(v);
      sets.push(`${k} = $${params.length}`);
    }
  }
  if (r.kind === 'design' && (req.body.work_type || 'product_context' in req.body)) {
    const it = await db.one('SELECT * FROM request_items WHERE request_id = $1 ORDER BY sort, id LIMIT 1', [r.id]);
    if (it) {
      await db.q('UPDATE request_items SET product_type = COALESCE($2, product_type), item_notes = COALESCE($3, item_notes) WHERE id = $1',
        [it.id, req.body.work_type ? String(req.body.work_type).slice(0, 60) : null, 'product_context' in req.body ? String(req.body.product_context || '') : null]);
    }
  }
  if (sets.length) {
    r = await db.one(`UPDATE requests SET ${sets.join(', ')}, updated_at = now() WHERE id = $1 RETURNING *`, params);
    if ('artist_id' in req.body) {
      const a = req.body.artist_id ? await db.one('SELECT name, email FROM users WHERE id = $1', [req.body.artist_id]) : null;
      await wf.log(r.id, { userId: req.user.id, kind: 'system', body: a ? `Assigned to ${a.name || a.email}` : 'Unassigned artist' });
    }
  }
  if (Array.isArray(req.body.items)) {
    if (await db.one('SELECT 1 FROM proof_versions WHERE request_id = $1 LIMIT 1', [r.id])) {
      throw fail(400, 'Products can\'t be replaced once proofs exist.');
    }
    const items = cleanItems(req.body.items);
    await db.tx(async (t) => {
      await t.q('DELETE FROM request_items WHERE request_id = $1', [r.id]);
      await insertItems(t, r.id, items);
    });
    await wf.log(r.id, { userId: req.user.id, kind: 'system', body: 'Updated product details' });
  }
  if (req.body.status) {
    if (!(await cols.getColumns()).some((c) => c.key === req.body.status)) throw fail(400, 'Unknown column');
    r = await wf.setStatus(r, req.body.status, { userId: req.user.id });
  }
  res.json({ request: await wf.loadDetail(r.id) });
}));

// Kanban drag: { status, beforeId?, afterId? } → position between neighbors.
router.post('/api/requests/:id/move', express.json(), wrap(async (req, res) => {
  let r = await getRequest(req.params.id);
  const { status, beforeId, afterId } = req.body;
  if (!(await cols.getColumns()).some((c) => c.key === status)) throw fail(400, 'Unknown column');
  const before = beforeId ? await db.one('SELECT position FROM requests WHERE id = $1', [beforeId]) : null;
  const after = afterId ? await db.one('SELECT position FROM requests WHERE id = $1', [afterId]) : null;
  let pos;
  if (before && after) pos = (before.position + after.position) / 2;
  else if (before) pos = before.position + 1;
  else if (after) pos = after.position - 1;
  else pos = 0;
  if (status !== r.status) r = await wf.setStatus(r, status, { userId: req.user.id });
  await db.q('UPDATE requests SET position = $2 WHERE id = $1', [r.id, pos]);
  res.json({ ok: true });
}));

router.post('/api/requests/:id/artwork', upload.array('artwork', 15), wrap(async (req, res) => {
  const r = await getRequest(req.params.id);
  let itemId = req.body.item_id ? parseInt(req.body.item_id, 10) : null;
  if (itemId && !(await db.one('SELECT 1 FROM request_items WHERE id = $1 AND request_id = $2', [itemId, r.id]))) itemId = null;
  const saved = await saveArtwork(r, req.files, req.user.id, itemId);
  await wf.log(r.id, { userId: req.user.id, kind: 'system', body: `Added ${saved.length} artwork file(s)` });
  res.json({ request: await wf.loadDetail(r.id) });
}));

router.post('/api/requests/:id/comments', express.json(), wrap(async (req, res) => {
  const r = await getRequest(req.params.id);
  const body = String(req.body.body || '').trim();
  if (!body) throw fail(400, 'Comment is empty');
  await wf.log(r.id, { userId: req.user.id, kind: 'comment', body });
  push.notify([r.rep_id, r.artist_id], 'comment', {
    title: `${req.user.name || req.user.email} commented on ${r.job_name}`, body: body.slice(0, 180),
    url: wf.appRequestUrl(r), excludeUserId: req.user.id,
  });
  res.json({ request: await wf.loadDetail(r.id) });
}));

// ---------- Repeat previous: recent products to copy decoration from ----------
router.get('/api/items/previous', wrap(async (req, res) => {
  const q = String(req.query.q || '').trim().toLowerCase();
  const email = String(req.query.email || '').trim().toLowerCase();
  const params = [];
  let where = `r.kind <> 'design'`;
  if (q) {
    params.push(`%${q}%`);
    where += ` AND (lower(r.job_name) LIKE $1 OR lower(COALESCE(r.client_company,'')) LIKE $1 OR lower(COALESCE(r.client_name,'')) LIKE $1
      OR lower(COALESCE(r.client_email,'')) LIKE $1 OR lower(concat_ws(' ', i.brand, i.style)) LIKE $1)`;
  }
  params.push(email);
  const rows = await db.q(
    `SELECT i.*, r.job_name, r.client_company, r.client_name, r.client_email, r.created_at AS request_created_at
     FROM request_items i JOIN requests r ON r.id = i.request_id
     WHERE ${where}
     ORDER BY (lower(COALESCE(r.client_email,'')) = $${params.length} AND $${params.length} <> '') DESC, r.created_at DESC, i.sort
     LIMIT 25`,
    params
  );
  res.json({ items: rows.map((i) => ({ ...i, label: wf.itemLabel(i) })) });
}));

// ---------- Editing products after submission ----------
const ITEM_FIELDS = ['source', 'product_type', 'brand', 'style', 'title', 'color_name', 'color_hex', 'swatch_url', 'image_url',
  'back_image_url', 'vendor_url', 'ss_style_id', 'decoration_type', 'decorator', 'sp_options', 'locations', 'print_colors', 'item_notes', 'colors', 'garments', 'subname'];
const FIELD_NAMES = { product_type: 'type', brand: 'brand', style: 'style', color_name: 'color', vendor_url: 'vendor link',
  subname: 'subname', decoration_type: 'decoration', decorator: 'decorator', sp_options: 'print options', locations: 'locations', print_colors: 'ink colors', item_notes: 'notes' };
const show = (v) => (Array.isArray(v) ? v.join(', ') : v) || '—';

async function tellArtist(r, req, text) {
  if (r.artist_id && r.artist_id !== req.user.id) {
    push.notify([r.artist_id], 'comment', { title: `${req.user.name || req.user.email} updated ${r.job_name}`, body: text.slice(0, 180), url: wf.appRequestUrl(r) });
  }
}

router.post('/api/requests/:id/items', express.json(), wrap(async (req, res) => {
  const r = await getRequest(req.params.id);
  const [it] = cleanItems([req.body.item]);
  const max = await db.one('SELECT COALESCE(max(sort), -1) + 1 AS s FROM request_items WHERE request_id = $1', [r.id]);
  it.sort = max.s;
  const [id] = await db.tx((t) => insertItems(t, r.id, [it]));
  const text = `Added product ${wf.itemLabel(it)} (${it.color_name})`;
  await wf.log(r.id, { userId: req.user.id, kind: 'system', body: text });
  tellArtist(r, req, text);
  res.status(201).json({ itemId: id, request: await wf.loadDetail(r.id) });
}));

router.patch('/api/requests/:id/items/:itemId', express.json(), wrap(async (req, res) => {
  const r = await getRequest(req.params.id);
  const old = await db.one('SELECT * FROM request_items WHERE id = $1 AND request_id = $2', [parseInt(req.params.itemId, 10), r.id]);
  if (!old) throw fail(404, 'Product not found');
  const [it] = cleanItems([req.body.item]);
  const sets = ITEM_FIELDS.map((f, i) => `${f} = $${i + 2}`).join(', ');
  await db.q(`UPDATE request_items SET ${sets} WHERE id = $1`, [old.id, ...ITEM_FIELDS.map((f) => (['colors', 'garments'].includes(f) ? JSON.stringify(it[f] || []) : it[f]))]);
  const changes = Object.keys(FIELD_NAMES)
    .filter((f) => show(old[f]) !== show(it[f]))
    .map((f) => `${FIELD_NAMES[f]}: ${show(old[f])} → ${show(it[f])}`);
  const gl = (arr) => (arr || []).map((g) => `${wf.itemLabel(g)} (${g.color_name})`).join(' + ') || 'none';
  if (gl(old.garments) !== gl(it.garments)) changes.push(`garments running together: ${gl(old.garments)} → ${gl(it.garments)}`);
  if (changes.length) {
    const text = `Edited ${wf.itemLabel(it)} — ${changes.join('; ')}`;
    await wf.log(r.id, { userId: req.user.id, kind: 'system', body: text });
    tellArtist(r, req, text);
  }
  await db.q('UPDATE requests SET updated_at = now() WHERE id = $1', [r.id]);
  res.json({ request: await wf.loadDetail(r.id) });
}));

router.delete('/api/requests/:id/items/:itemId', wrap(async (req, res) => {
  const r = await getRequest(req.params.id);
  const it = await db.one('SELECT * FROM request_items WHERE id = $1 AND request_id = $2', [parseInt(req.params.itemId, 10), r.id]);
  if (!it) throw fail(404, 'Product not found');
  if (await db.one('SELECT 1 FROM proof_versions WHERE item_id = $1 LIMIT 1', [it.id])) throw fail(400, 'This product already has proofs, so it can\'t be removed.');
  const n = await db.one('SELECT count(*)::int AS n FROM request_items WHERE request_id = $1', [r.id]);
  if (n.n <= 1) throw fail(400, 'A request needs at least one product.');
  await db.q('DELETE FROM request_items WHERE id = $1', [it.id]); // its artwork becomes job-wide artwork
  await wf.log(r.id, { userId: req.user.id, kind: 'system', body: `Removed product ${wf.itemLabel(it)}` });
  res.json({ request: await wf.loadDetail(r.id) });
}));

// ---------- Proofs (per product) ----------
// Latest version per item, with its response, for a request.
async function latestVersions(requestId) {
  const rows = await db.q(
    `SELECT DISTINCT ON (v.item_id) v.*, r.action AS response_action, i.brand, i.style, i.title, i.product_type, i.color_name
     FROM proof_versions v JOIN request_items i ON i.id = v.item_id LEFT JOIN responses r ON r.version_id = v.id
     WHERE v.request_id = $1 ORDER BY v.item_id, v.version DESC`,
    [requestId]
  );
  return rows.map((v) => ({ ...v, state: wf.itemState(v, v.response_action ? { action: v.response_action } : null), label: wf.itemLabel(v) }));
}

// Artist returns a proof: file upload OR pasted Dropbox link, for one or more products,
// plus warnings and optional sales review.
router.post('/api/requests/:id/proofs', upload.single('file'), wrap(async (req, res) => {
  let r = await getRequest(req.params.id);
  const body = req.body;
  const link = String(body.link || '').trim();
  if (!req.file && !link) throw fail(400, 'Upload the proof or paste its Dropbox link.');
  if (link && !/^https:\/\/(www\.)?dropbox\.com\//i.test(link)) throw fail(400, 'That doesn\'t look like a Dropbox link.');

  let itemIds = [];
  try { itemIds = JSON.parse(body.item_ids || '[]').map(Number); } catch { itemIds = []; }
  const items = await db.q('SELECT * FROM request_items WHERE request_id = $1 AND id = ANY($2::int[]) ORDER BY sort, id', [r.id, itemIds]);
  if (!items.length) throw fail(400, 'Choose which product(s) this proof is for.');
  const latest = await latestVersions(r.id);
  for (const it of items) {
    const l = latest.find((v) => v.item_id === it.id);
    if (l && l.state === 'review') throw fail(400, `${wf.itemLabel(it)} already has a proof waiting on sales review.`);
  }

  const allWarnings = await db.getSetting('warnings', db.DEFAULT_WARNINGS);
  let keys = [];
  try { keys = JSON.parse(body.warnings || '[]'); } catch { keys = []; }
  const warnings = allWarnings.filter((w) => keys.includes(w.key)).map((w) => ({ key: w.key, text: w.text }));
  const other = String(body.other_warning || '').trim();
  if (other) warnings.push({ key: 'other', text: other });

  const salesReview = body.sales_review_required === 'true' || body.sales_review_required === '1';
  const reviewNote = String(body.sales_review_note || '').trim();
  if (salesReview && !reviewNote) throw fail(400, 'Tell the rep what needs review.');

  const jobFolder = r.dropbox_folder || dropbox.jobFolder(r.job_name);
  const proofsFolder = `${jobFolder}/${dropbox.cfg.proofsSubfolder}`;
  await dropbox.ensureFolder(jobFolder);
  await dropbox.ensureFolder(proofsFolder);
  const nextVersion = async (itemId) => (await db.one('SELECT COALESCE(max(version), 0) + 1 AS v FROM proof_versions WHERE item_id = $1', [itemId])).v;
  // Version used in the file name: the highest new version among the products this file covers.
  let fileVersion = 1;
  for (const it of items) fileVersion = Math.max(fileVersion, await nextVersion(it.id));

  let fileRow;
  if (req.file) {
    const fileName = proofFiles.versionedName(req.file.originalname, fileVersion);
    const stored = await dropbox.upload(proofsFolder, fileName, req.file.buffer);
    fileRow = await db.one(
      `INSERT INTO files(request_id, kind, name, dropbox_path, local_path, size, mime, created_by)
       VALUES ($1,'proof',$2,$3,$4,$5,$6,$7) RETURNING *`,
      [r.id, fileName, stored.dropbox_path || null, stored.local_path || null, req.file.size, req.file.mimetype, req.user.id]
    );
  } else {
    let imported;
    try {
      imported = await dropbox.importSharedLink(link, proofsFolder, (n) => proofFiles.versionedName(n, fileVersion));
    } catch (e) {
      throw fail(400, `Couldn't read that Dropbox link. Make sure it's a share link to a file. (${e.message})`);
    }
    fileRow = await db.one(
      `INSERT INTO files(request_id, kind, name, dropbox_path, link_url, mime, created_by)
       VALUES ($1,'proof',$2,$3,$4,$5,$6) RETURNING *`,
      [r.id, imported.name, imported.dropbox_path, link, imported.mime || dropbox.guessMime(imported.name), req.user.id]
    );
  }

  const batchId = wf.newToken().slice(0, 12);
  const made = [];
  for (const it of items) {
    const v = await nextVersion(it.id);
    await db.q(
      `INSERT INTO proof_versions(request_id, item_id, batch_id, version, file_id, warnings, artist_note, sales_review_required,
         sales_review_note, sales_review_status, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [r.id, it.id, batchId, v, fileRow.id, JSON.stringify(warnings), String(body.artist_note || '').trim() || null,
        salesReview, reviewNote || null, salesReview ? 'pending' : null, req.user.id]
    );
    made.push(`${wf.itemLabel(it)} v${v}`);
  }
  await wf.log(r.id, {
    userId: req.user.id, kind: 'proof',
    body: `Added proof: ${made.join(', ')}${warnings.length ? ` (${warnings.length} warning${warnings.length > 1 ? 's' : ''})` : ''}${salesReview ? ' — needs sales review' : ''}`,
  });
  if (!r.artist_id) r = await db.one('UPDATE requests SET artist_id = $2 WHERE id = $1 RETURNING *', [r.id, req.user.id]);

  if (salesReview) {
    const rep = r.rep_id ? await db.one('SELECT * FROM users WHERE id = $1', [r.rep_id]) : null;
    const who = req.user.name || req.user.email;
    push.notify([r.rep_id], 'sales_review', {
      title: `Sales review needed: ${r.job_name}`, body: `${who}: ${reviewNote}`.slice(0, 180),
      url: wf.appRequestUrl(r), excludeUserId: req.user.id,
    });
    if (rep) {
      notify.notifyStaffEmail(rep.email, `Sales review needed: ${r.job_name}`,
        `<p><strong>${notify.esc(who)}</strong> needs your review on the proof for <strong>${notify.esc(made.join(', '))}</strong> (${notify.esc(r.job_name)}) before it goes to the client.</p>
         <p style="white-space:pre-wrap;background:#fff4e5;padding:12px;border-radius:6px;">${notify.esc(reviewNote)}</p>
         <p>${notify.button(wf.appRequestUrl(r), 'Review proof')}</p>`);
    }
    notify.missivePost(r.missive_conversation_id, {
      title: `Sales review needed: ${r.job_name}`,
      body: `${who}: ${reviewNote}`,
      markdown: `⚠️ **Sales review needed** — ${made.join(', ')} on [${r.job_name}](${wf.appRequestUrl(r)})${rep ? ` · ${rep.name || rep.email}` : ''}\n\n> ${reviewNote.replace(/\n/g, '\n> ')}`,
    });
  }
  await wf.recomputeStatus(r, { userId: req.user.id });
  await proofFiles.tidy(r); // the version this one replaces moves to Proofs/Old Versions
  res.status(201).json({ request: await wf.loadDetail(r.id) });
}));

// Sales review applies to everything uploaded together (one batch).
router.post('/api/requests/:id/batches/:batch/review', express.json(), wrap(async (req, res) => {
  const r = await getRequest(req.params.id);
  const versions = await db.q(
    `SELECT v.*, i.brand, i.style, i.title, i.product_type FROM proof_versions v JOIN request_items i ON i.id = v.item_id
     WHERE v.request_id = $1 AND v.batch_id = $2 AND v.sales_review_status = 'pending'`,
    [r.id, req.params.batch]
  );
  if (!versions.length) throw fail(400, 'Nothing here is waiting on review.');
  const decision = req.body.decision === 'approved' ? 'approved' : 'returned';
  const reply = String(req.body.reply || '').trim();
  if (decision === 'returned' && !reply) throw fail(400, 'Add a note for the artist.');
  await db.q(
    `UPDATE proof_versions SET sales_review_status = $3, sales_review_reply = $4, sales_review_by = $5, sales_review_at = now()
     WHERE request_id = $1 AND batch_id = $2 AND sales_review_status = 'pending'`,
    [r.id, req.params.batch, decision, reply || null, req.user.id]
  );
  const labels = versions.map((v) => `${wf.itemLabel(v)} v${v.version}`).join(', ');
  const who = req.user.name || req.user.email;
  await wf.log(r.id, { userId: req.user.id, kind: 'review', body: decision === 'approved' ? `Cleared ${labels} to send${reply ? `: ${reply}` : ''}` : `Sent ${labels} back to art: ${reply}` });
  await wf.recomputeStatus(r, { userId: req.user.id });
  push.notify([versions[0].created_by], 'review_decision', {
    title: decision === 'approved' ? `Cleared to send: ${r.job_name}` : `Sent back by sales: ${r.job_name}`,
    body: `${who}${reply ? `: ${reply}` : ` — ${labels}`}`.slice(0, 180),
    url: wf.appRequestUrl(r), excludeUserId: req.user.id,
  });
  const artist = versions[0].created_by ? await db.one('SELECT * FROM users WHERE id = $1', [versions[0].created_by]) : null;
  if (artist && artist.id !== req.user.id) {
    notify.notifyStaffEmail(artist.email,
      decision === 'approved' ? `Cleared to send: ${r.job_name}` : `Changes from sales: ${r.job_name}`,
      `<p><strong>${notify.esc(who)}</strong> ${decision === 'approved' ? 'cleared' : 'sent back'} ${notify.esc(labels)} for <strong>${notify.esc(r.job_name)}</strong>.</p>
       ${reply ? `<p style="white-space:pre-wrap;background:#f6f3f0;padding:12px;border-radius:6px;">${notify.esc(reply)}</p>` : ''}
       <p>${notify.button(wf.appRequestUrl(r), 'Open request')}</p>`);
  }
  res.json({ request: await wf.loadDetail(r.id) });
}));

// Email every proof that's ready (latest version per product, cleared, unsent) in one message.
// If nothing new is ready but proofs are out with the client, this re-sends the link as a reminder.
router.post('/api/requests/:id/send', express.json(), wrap(async (req, res) => {
  let r = await getRequest(req.params.id);
  const latest = await latestVersions(r.id);
  const ready = latest.filter((v) => v.state === 'ready');
  const awaiting = latest.filter((v) => v.state === 'awaiting');
  if (!r.client_email) throw fail(400, 'Add a client email first (Edit, next to the request name).');
  const reminder = !ready.length;
  if (reminder && !awaiting.length) throw fail(400, 'There are no proofs ready to send.');
  const rep = await db.one('SELECT * FROM users WHERE id = $1', [r.rep_id || req.user.id]);
  const included = (reminder ? awaiting : ready).map((v) => `${v.label}${v.color_name ? ` (${v.color_name})` : ''} — v${v.version}`);
  try {
    await notify.sendProofEmail({ request: r, products: included, reminder, rep, proofUrl: wf.proofUrl(r), message: String(req.body.message || '').trim() });
  } catch (e) {
    throw fail(502, `The email didn't send: ${e.message}`);
  }
  if (ready.length) await db.q(`UPDATE proof_versions SET sent_via = 'email', sent_at = now() WHERE id = ANY($1::int[])`, [ready.map((v) => v.id)]);
  await wf.log(r.id, { userId: req.user.id, kind: 'sent', body: `${reminder ? 'Re-sent the proof link' : `Emailed ${included.join(', ')}`} to ${r.client_email}${r.cc_emails ? ` (cc ${r.cc_emails})` : ''}` });
  r = await wf.recomputeStatus(r, { userId: req.user.id });
  if (!reminder) {
    notify.missivePost(r.missive_conversation_id, {
      title: `Proof sent: ${r.job_name}`,
      body: `Emailed to ${r.client_email}: ${included.join(', ')}`,
      markdown: `📤 **Proof emailed** to ${r.client_email}: ${included.join(', ')} — [client link](${wf.proofUrl(r)}) · [request](${wf.appRequestUrl(r)})`,
    });
  }
  res.json({ request: await wf.loadDetail(r.id) });
}));

// "Copy live link" — for sending with a Sales Order. Marks everything ready as sent via link.
router.post('/api/requests/:id/share-link', wrap(async (req, res) => {
  let r = await getRequest(req.params.id);
  const latest = await latestVersions(r.id);
  const ready = latest.filter((v) => v.state === 'ready');
  if (!ready.length && !latest.some((v) => ['awaiting', 'approved', 'changes'].includes(v.state))) {
    throw fail(400, 'There are no proofs ready to share yet.');
  }
  if (ready.length) {
    await db.q(`UPDATE proof_versions SET sent_via = 'link', sent_at = now() WHERE id = ANY($1::int[])`, [ready.map((v) => v.id)]);
    await db.q('UPDATE requests SET link_shared_at = now() WHERE id = $1', [r.id]);
    await wf.log(r.id, { userId: req.user.id, kind: 'sent', body: `Copied the live link (${ready.map((v) => `${v.label} v${v.version}`).join(', ')})` });
    r = await wf.recomputeStatus(r, { userId: req.user.id });
  }
  res.json({ url: wf.proofUrl(r), request: await wf.loadDetail(r.id) });
}));

// ---------- Push notifications ----------
router.get('/api/push/config', wrap(async (req, res) => {
  const u = await db.one('SELECT notify_prefs FROM users WHERE id = $1', [req.user.id]);
  res.json({ publicKey: await push.publicKey(), events: push.EVENTS, prefs: push.prefsOf(u || {}) });
}));
router.post('/api/push/subscribe', express.json(), wrap(async (req, res) => {
  const sub = req.body.subscription || {};
  if (!/^https:\/\//.test(sub.endpoint || '') || !sub.keys || !sub.keys.p256dh || !sub.keys.auth) throw fail(400, 'Bad subscription');
  await db.q(
    `INSERT INTO push_subscriptions(user_id, endpoint, keys, user_agent) VALUES ($1,$2,$3,$4)
     ON CONFLICT (endpoint) DO UPDATE SET user_id = EXCLUDED.user_id, keys = EXCLUDED.keys`,
    [req.user.id, sub.endpoint, JSON.stringify(sub.keys), String(req.headers['user-agent'] || '').slice(0, 300)]
  );
  res.json({ ok: true });
}));
router.post('/api/push/unsubscribe', express.json(), wrap(async (req, res) => {
  await db.q('DELETE FROM push_subscriptions WHERE endpoint = $1 AND user_id = $2', [String(req.body.endpoint || ''), req.user.id]);
  res.json({ ok: true });
}));
router.put('/api/push/prefs', express.json(), wrap(async (req, res) => {
  const prefs = {};
  for (const e of push.EVENTS) prefs[e.key] = Boolean(req.body.prefs && req.body.prefs[e.key]);
  await db.q('UPDATE users SET notify_prefs = $2 WHERE id = $1', [req.user.id, JSON.stringify(prefs)]);
  res.json({ prefs });
}));
router.post('/api/push/test', wrap(async (req, res) => {
  const n = await db.one('SELECT count(*)::int AS n FROM push_subscriptions WHERE user_id = $1', [req.user.id]);
  if (!n.n) throw fail(400, 'Notifications aren\'t turned on in this browser yet.');
  await push.notify([req.user.id], 'test', { title: 'Inkmule Proofs', body: 'Notifications are working on this computer.', url: `${config.appUrl}/settings`, force: true });
  res.json({ ok: true, devices: n.n });
}));

// Staff file download/preview (artwork or proofs).
router.get('/api/files/:id', wrap(async (req, res) => {
  const f = await db.one('SELECT * FROM files WHERE id = $1', [parseInt(req.params.id, 10)]);
  if (!f) throw fail(404, 'File not found');
  const { stream } = await dropbox.download(f);
  res.setHeader('Content-Type', f.mime || dropbox.guessMime(f.name));
  res.setHeader('Content-Disposition', `${req.query.download ? 'attachment' : 'inline'}; filename="${encodeURIComponent(f.name)}"`);
  stream.pipe(res);
}));

module.exports = router;

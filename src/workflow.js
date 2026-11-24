// Shared workflow helpers: statuses, activity log, loading a full request.

const crypto = require('crypto');
const config = require('./config');
const db = require('./db');
const dropbox = require('./dropbox');

const cols = require('./columns');
const labelIn = (columns, k) => (columns.find((c) => c.key === k) || {}).label || k;

const newToken = () => crypto.randomBytes(18).toString('base64url');
const jobKey = (name) => String(name || '').trim().toLowerCase().replace(/\s+/g, ' ');
const proofUrl = (r) => `${config.appUrl}/p/${r.public_token}`;
const appRequestUrl = (r) => `${config.appUrl}/requests/${r.id}`;

async function log(requestId, { userId = null, actor = null, kind, body }) {
  await db.q('INSERT INTO activity(request_id, user_id, actor, kind, body) VALUES ($1,$2,$3,$4,$5)', [
    requestId, userId, actor, kind, body,
  ]);
}

async function setStatus(request, status, { userId, actor, note } = {}) {
  const columns = await cols.getColumns();
  if (!columns.some((c) => c.key === status) || request.status === status) return request;
  const min = await db.one('SELECT COALESCE(min(position), 0) - 1 AS p FROM requests WHERE status = $1', [status]);
  const updated = await db.one(
    `UPDATE requests SET status = $2, position = $3, updated_at = now(),
       approved_at = CASE WHEN $2 = 'approved' THEN now() ELSE approved_at END
     WHERE id = $1 RETURNING *`,
    [request.id, status, min.p]
  );
  await log(request.id, { userId, actor, kind: 'status', body: `Moved to ${labelIn(columns, status)}${note ? ` — ${note}` : ''}` });
  return updated;
}

function fileOut(f) {
  if (!f) return null;
  return {
    id: f.id, kind: f.kind, name: f.name, mime: f.mime, size: f.size ? Number(f.size) : null,
    created_at: f.created_at,
    url: `/api/files/${f.id}`,
    dropboxUrl: f.dropbox_path ? dropbox.webUrl(f.dropbox_path) : (f.link_url || null),
  };
}

const garmentLabel = (g) => [g.brand, g.style].filter(Boolean).join(' ') || g.title || g.product_type || 'Product';
// A product's label lists every garment that runs with that print, e.g. "Comfort Colors 1717 + Independent SS4500".
const itemLabel = (it) => [it, ...(Array.isArray(it.garments) ? it.garments : [])].map(garmentLabel).join(' + ');

// State of one product, from its latest proof version (+ the client's response to it).
function itemState(latest, response) {
  if (!latest) return 'none';
  if (response) return response.action === 'approved' ? 'approved' : 'changes';
  if (latest.sales_review_status === 'pending') return 'review';
  if (latest.sales_review_status === 'returned') return 'returned';
  if (!latest.sent_at) return 'ready';
  return 'awaiting';
}

function summarize(states, viewedCount = 0) {
  const c = (k) => states.filter((s) => s === k).length;
  return {
    total: states.length, none: c('none'), review: c('review'), returned: c('returned'), ready: c('ready'),
    awaiting: c('awaiting'), approved: c('approved'), changes: c('changes'), viewed: viewedCount,
  };
}

// The board column a request belongs in, given its products' states.
function statusFromSummary(sum) {
  if (sum.total === 0 || sum.none === sum.total) return null; // nothing proofed yet: leave where it is
  if (sum.review) return 'sales_review';
  if (sum.changes) return 'changes';
  if (sum.returned || sum.ready || sum.none) return 'ready';
  if (sum.awaiting) return 'sent';
  if (sum.approved === sum.total) return 'approved';
  return null;
}

// Latest version (+response) per item for a set of requests.
async function latestByItem(requestIds) {
  if (!requestIds.length) return [];
  return db.q(
    `SELECT DISTINCT ON (v.item_id) v.*, r.action AS response_action
     FROM proof_versions v LEFT JOIN responses r ON r.version_id = v.id
     WHERE v.request_id = ANY($1::int[]) ORDER BY v.item_id, v.version DESC`,
    [requestIds]
  );
}

async function summaryFor(requestIds) {
  const [items, latest] = await Promise.all([
    db.q('SELECT id, request_id FROM request_items WHERE request_id = ANY($1::int[])', [requestIds]),
    latestByItem(requestIds),
  ]);
  const byItem = new Map(latest.map((v) => [v.item_id, v]));
  const out = new Map();
  for (const id of requestIds) {
    const its = items.filter((i) => i.request_id === id);
    const states = its.map((i) => {
      const v = byItem.get(i.id);
      return itemState(v, v && v.response_action ? { action: v.response_action } : null);
    });
    const viewed = its.filter((i) => { const v = byItem.get(i.id); return v && v.sent_at && v.client_viewed_at && !v.response_action; }).length;
    out.set(id, summarize(states, viewed));
  }
  return out;
}

// Re-derive the board column after any proof/review/send/client event.
// The event is mapped to a column in Settings ('' = leave the card where it is).
// Cards in an archive column are never moved automatically.
async function recomputeStatus(request, { userId, actor, note } = {}) {
  const [columns, automation] = await Promise.all([cols.getColumns(), cols.getAutomation()]);
  const current = columns.find((c) => c.key === request.status);
  if (current && current.archive) return request;
  const sum = (await summaryFor([request.id])).get(request.id);
  const event = statusFromSummary(sum);
  const next = event && automation[event];
  if (!next || next === request.status) return request;
  return setStatus(request, next, { userId, actor, note });
}

async function loadDetail(id) {
  const r = await db.one(
    `SELECT r.*, rep.name AS rep_name, rep.email AS rep_email, art.name AS artist_name, art.email AS artist_email
     FROM requests r LEFT JOIN users rep ON rep.id = r.rep_id LEFT JOIN users art ON art.id = r.artist_id
     WHERE r.id = $1`,
    [id]
  );
  if (!r) return null;
  const columns = await cols.getColumns();
  const [items, files, versions, responses, activity] = await Promise.all([
    db.q('SELECT * FROM request_items WHERE request_id = $1 ORDER BY sort, id', [id]),
    db.q('SELECT * FROM files WHERE request_id = $1 ORDER BY created_at', [id]),
    db.q(
      `SELECT v.*, u.name AS created_by_name, sr.name AS sales_review_by_name
       FROM proof_versions v LEFT JOIN users u ON u.id = v.created_by LEFT JOIN users sr ON sr.id = v.sales_review_by
       WHERE v.request_id = $1 ORDER BY v.version DESC, v.id DESC`,
      [id]
    ),
    db.q('SELECT * FROM responses WHERE request_id = $1 ORDER BY created_at DESC', [id]),
    db.q(
      `SELECT a.*, u.name AS user_name, u.picture AS user_picture FROM activity a LEFT JOIN users u ON u.id = a.user_id
       WHERE a.request_id = $1 ORDER BY a.created_at DESC, a.id DESC LIMIT 200`,
      [id]
    ),
  ]);
  const fileById = new Map(files.map((f) => [f.id, f]));
  const outVersions = versions.map((v) => ({
    ...v,
    file: fileOut(fileById.get(v.file_id)),
    approved_file: fileOut(fileById.get(v.approved_file_id)),
    responses: responses.filter((x) => x.version_id === v.id),
    batch_items: versions.filter((x) => x.batch_id === v.batch_id).map((x) => x.item_id),
  }));
  const outItems = items.map((it) => {
    const vs = outVersions.filter((v) => v.item_id === it.id);
    const latest = vs[0] || null;
    return {
      ...it,
      label: itemLabel(it),
      state: itemState(latest, latest && latest.responses[0]),
      versions: vs,
      artwork: files.filter((f) => f.kind === 'artwork' && f.item_id === it.id).map(fileOut),
    };
  });
  const summary = summarize(outItems.map((i) => i.state), outItems.filter((i) => i.state === 'awaiting' && i.versions[0].client_viewed_at).length);
  return {
    ...r,
    status_label: labelIn(columns, r.status),
    proof_url: proofUrl(r),
    app_url: appRequestUrl(r),
    dropbox_folder_url: r.dropbox_folder && dropbox.enabled() ? dropbox.webUrl(r.dropbox_folder) : null,
    items: outItems,
    summary,
    artwork: files.filter((f) => f.kind === 'artwork' && !f.item_id).map(fileOut),
    activity,
  };
}

// Compact rows for the board / list / sidebar.
async function listRequests({ status, q, conversationId, includeDone } = {}) {
  const where = [];
  const params = [];
  const columns = await cols.getColumns();
  const archiveKeys = columns.filter((c) => c.archive).map((c) => c.key);
  if (status) { params.push(status); where.push(`r.status = $${params.length}`); }
  else if (!includeDone && !conversationId && archiveKeys.length) {
    // Archive columns only show the last 14 days on the board.
    params.push(archiveKeys);
    where.push(`(NOT (r.status = ANY($${params.length}::text[])) OR r.updated_at > now() - interval '14 days')`);
  }
  if (conversationId) { params.push(conversationId); where.push(`r.missive_conversation_id = $${params.length}`); }
  if (q) {
    params.push(`%${q.toLowerCase()}%`);
    where.push(`(lower(r.job_name) LIKE $${params.length} OR lower(r.client_email) LIKE $${params.length}
      OR lower(COALESCE(r.client_name,'')) LIKE $${params.length} OR lower(COALESCE(r.client_company,'')) LIKE $${params.length})`);
  }
  const rows = await db.q(
    `SELECT r.id, r.kind, r.job_name, r.client_name, r.client_company, r.client_email, r.status, r.position, r.due_date,
       r.created_at, r.updated_at, r.client_viewed_at, r.approved_at, r.missive_conversation_id, r.public_token,
       r.rep_id, rep.name AS rep_name, rep.picture AS rep_picture,
       r.artist_id, art.name AS artist_name, art.picture AS artist_picture,
       (SELECT image_url FROM request_items i WHERE i.request_id = r.id AND image_url IS NOT NULL ORDER BY sort, id LIMIT 1) AS thumb,
       (SELECT string_agg(COALESCE(NULLIF(trim(concat_ws(' ', brand, style)), ''), product_type)
            || COALESCE((SELECT string_agg(' + ' || COALESCE(NULLIF(trim(concat_ws(' ', g->>'brand', g->>'style')), ''), g->>'product_type'), '')
                         FROM jsonb_array_elements(i.garments) g), ''), ', ' ORDER BY sort, id)
          FROM request_items i WHERE i.request_id = r.id) AS products,
       (SELECT string_agg(DISTINCT decoration_type, ', ') FROM request_items i WHERE i.request_id = r.id) AS decorations
     FROM requests r
     LEFT JOIN users rep ON rep.id = r.rep_id
     LEFT JOIN users art ON art.id = r.artist_id
     ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
     ORDER BY r.position, r.id DESC`,
    params
  );
  const sums = await summaryFor(rows.map((r) => r.id));
  return rows.map((r) => ({ ...r, status_label: labelIn(columns, r.status), proof_url: proofUrl(r), summary: sums.get(r.id) }));
}

module.exports = { newToken, jobKey, proofUrl, appRequestUrl, log, setStatus, recomputeStatus, loadDetail, listRequests, fileOut, itemLabel, itemState };

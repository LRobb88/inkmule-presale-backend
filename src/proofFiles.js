// Keeps the job's Dropbox Proofs folder unambiguous:
//   Proofs/                 only the current version of each product still waiting on the client
//   Proofs/Approved/        "APPROVED - <product> - <file>" copies of approved proofs + approval records
//   Proofs/Old Versions/    everything superseded (still viewable in the app and on the client page)

const db = require('./db');
const dropbox = require('./dropbox');
const wf = require('./workflow');

const APPROVED = 'Approved';
const OLD = 'Old Versions';

// Keep the artist's own file name (e.g. TESTJOB1226-TEE_layout.pdf) and add the version:
// v1 → TESTJOB1226-TEE_layout.pdf, v2 → TESTJOB1226-TEE_layout_V2.pdf. A version tag the artist
// already typed (_v2, -V3, " v4") is replaced rather than doubled. Approved copies get an APPROVED_ prefix.
function splitName(name) {
  const m = String(name || 'proof').match(/^(.*?)(\.[A-Za-z0-9]{1,5})?$/);
  const base = (m[1] || 'proof').replace(/^APPROVED[_\s-]+/i, '').replace(/[\s_-]*v\d+$/i, '').trim() || 'proof';
  return { base, ext: m[2] || '' };
}
function versionedName(name, version) {
  const { base, ext } = splitName(name);
  return `${base}${version > 1 ? `_V${version}` : ''}${ext}`;
}
const approvedName = (name, version) => `APPROVED_${versionedName(name, version)}`;

const proofsFolder = (r) => `${r.dropbox_folder || dropbox.jobFolder(r.job_name)}/${dropbox.cfg.proofsSubfolder}`;
const sameFolder = (a, b) => String(a).toLowerCase().replace(/^\//, '') === String(b).toLowerCase().replace(/^\//, '');

async function saveLocation(fileId, loc) {
  await db.q('UPDATE files SET dropbox_path = $2, local_path = $3 WHERE id = $1', [fileId, loc.dropbox_path || null, loc.local_path || null]);
}

// Move every proof file sitting directly in Proofs/ that no longer backs a "live" version
// (the latest version of a product that hasn't been approved) into Proofs/Old Versions/.
async function tidy(request) {
  const root = proofsFolder(request);
  const [files, latest] = await Promise.all([
    db.q(`SELECT * FROM files WHERE request_id = $1 AND kind = 'proof'`, [request.id]),
    db.q(
      `SELECT DISTINCT ON (v.item_id) v.id, v.file_id, r.action FROM proof_versions v LEFT JOIN responses r ON r.version_id = v.id
       WHERE v.request_id = $1 ORDER BY v.item_id, v.version DESC`,
      [request.id]
    ),
  ]);
  const live = new Set(latest.filter((v) => v.action !== 'approved').map((v) => v.file_id));
  for (const f of files) {
    const p = dropbox.filePath(f);
    if (!p || live.has(f.id) || !sameFolder(dropbox.parentOf(p), root)) continue;
    try {
      await saveLocation(f.id, await dropbox.relocate(f, `${root}/${OLD}`, p.split('/').pop(), 'move'));
    } catch (e) {
      console.error('Could not move superseded proof', f.id, e.message);
    }
  }
}

// On client approval: put an APPROVED copy of the exact file they approved in Proofs/Approved,
// with an approval record beside it, then tidy the rest away.
async function onApproved(request, version, item, { name, comment, ip }) {
  const root = proofsFolder(request);
  const label = `${wf.itemLabel(item)}${item.color_name ? ` (${item.color_name})` : ''}`;
  try {
    const file = await db.one('SELECT * FROM files WHERE id = $1', [version.file_id]);
    if (file) {
      const finalName = approvedName(file.name, version.version);
      // One file can cover several products; copy it into Approved only once.
      const existing = await db.one(`SELECT id FROM files WHERE request_id = $1 AND kind = 'approved' AND name = $2`, [request.id, finalName]);
      if (existing) {
        await db.q('UPDATE proof_versions SET approved_file_id = $2 WHERE id = $1', [version.id, existing.id]);
        throw Object.assign(new Error('already copied'), { skip: true });
      }
      const loc = await dropbox.relocate(file, `${root}/${APPROVED}`, finalName, 'copy');
      const row = await db.one(
        `INSERT INTO files(request_id, item_id, kind, name, dropbox_path, local_path, mime, size)
         VALUES ($1,$2,'approved',$3,$4,$5,$6,$7) RETURNING id`,
        [request.id, item.id, finalName, loc.dropbox_path || null, loc.local_path || null, file.mime, file.size]
      );
      await db.q('UPDATE proof_versions SET approved_file_id = $2 WHERE id = $1', [version.id, row.id]);
    }
  } catch (e) {
    if (e.skip) { /* same file already approved for another product */ } else {
    console.error('APPROVED copy failed', e.message);
    await wf.log(request.id, { actor: 'System', kind: 'system', body: `Couldn't save the APPROVED copy to Dropbox: ${e.message}` });
    }
  }
  try {
    const f = await db.one('SELECT name FROM files WHERE id = $1', [version.file_id]);
    const record = [
      `APPROVED — ${request.job_name}`, `Product: ${label}`, `Proof version: v${version.version}`, `Approved by: ${name}`,
      `Date: ${new Date().toISOString()}`, `Client email on file: ${request.client_email || ''}`,
      'Acknowledged notes:', ...(version.warnings || []).map((w) => `  ✓ ${w.text}`),
      comment ? `Comment: ${comment}` : '', `IP: ${ip}`,
    ].filter(Boolean).join('\n');
    await dropbox.ensureFolder(`${root}/${APPROVED}`);
    await dropbox.upload(`${root}/${APPROVED}`, `${approvedName(f ? f.name : 'proof', version.version).replace(/\.[A-Za-z0-9]{1,5}$/, '')} - ${wf.itemLabel(item)} approval record.txt`, Buffer.from(record));
  } catch (e) {
    console.error('approval record upload failed', e.message);
  }
  await tidy(request);
}

module.exports = { tidy, onApproved, versionedName, approvedName, APPROVED, OLD };

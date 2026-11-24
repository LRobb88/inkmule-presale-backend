// Customer-facing proof page API. Access is by the request's unguessable
// public token. Customers only ever see versions that have been sent
// (emailed or link shared). Signed-in staff can preview with ?preview=1.

const express = require('express');
const db = require('../db');
const dropbox = require('../dropbox');
const notify = require('../notify');
const wf = require('../workflow');
const push = require('../push');
const proofFiles = require('../proofFiles');

const router = express.Router();

async function load(token) {
  if (!/^[A-Za-z0-9_-]{10,60}$/.test(token || '')) return null;
  return db.one('SELECT * FROM requests WHERE public_token = $1', [token]);
}
const isPreview = (req) => Boolean(req.user) && req.query.preview === '1';

async function visibleVersions(r, preview) {
  return db.q(
    `SELECT v.*, f.name AS file_name, f.mime AS file_mime FROM proof_versions v LEFT JOIN files f ON f.id = v.file_id
     WHERE v.request_id = $1 ${preview ? '' : 'AND v.sent_at IS NOT NULL'} ORDER BY v.version DESC`,
    [r.id]
  );
}

router.get('/api/public/:token', async (req, res) => {
  try {
    const r = await load(req.params.token);
    if (!r) return res.status(404).json({ error: 'Proof not found' });
    const preview = isPreview(req);
    const [items, versions, responses, rep] = await Promise.all([
      db.q('SELECT id, product_type, brand, style, title, color_name, color_hex, image_url, decoration_type, locations, print_colors, garments FROM request_items WHERE request_id = $1 ORDER BY sort, id', [r.id]),
      visibleVersions(r, preview),
      db.q('SELECT version_id, action, signer_name, comment, created_at FROM responses WHERE request_id = $1 ORDER BY created_at DESC', [r.id]),
      r.rep_id ? db.one('SELECT name, email FROM users WHERE id = $1', [r.rep_id]) : null,
    ]);
    if (!preview) {
      const unseen = items.map((it) => versions.find((v) => v.item_id === it.id)).filter((v) => v && !v.client_viewed_at);
      if (unseen.length) {
        await db.q('UPDATE proof_versions SET client_viewed_at = now() WHERE id = ANY($1::int[])', [unseen.map((v) => v.id)]);
        await db.q('UPDATE requests SET client_viewed_at = COALESCE(client_viewed_at, now()) WHERE id = $1', [r.id]);
        push.notify([r.rep_id], 'client_viewed', { title: `Client opened the proof: ${r.job_name}`, body: r.client_name || r.client_email, url: wf.appRequestUrl(r) });
        await wf.log(r.id, { actor: 'Client', kind: 'client', body: `opened the proof page (${unseen.map((v) => `${wf.itemLabel(items.find((i) => i.id === v.item_id))} v${v.version}`).join(', ')})` });
      }
    }
    res.json({
      preview,
      job_name: r.job_name,
      client_name: r.client_name,
      client_company: r.client_company,
      status: r.status,
      rep: rep ? { name: rep.name, email: rep.email } : null,
      items: items.map((it) => ({
        ...it,
        label: wf.itemLabel(it),
        versions: versions.filter((v) => v.item_id === it.id).map((v) => ({
          id: v.id,
          version: v.version,
          sent_at: v.sent_at,
          warnings: v.warnings,
          note: v.artist_note,
          file: { name: v.file_name, mime: v.file_mime || dropbox.guessMime(v.file_name || ''), url: `/p/${r.public_token}/file/${v.id}` },
          response: responses.find((x) => x.version_id === v.id) || null,
        })),
      })),
    });
  } catch (e) {
    console.error('public load', e);
    res.status(500).json({ error: 'Something went wrong loading this proof.' });
  }
});

router.get('/p/:token/file/:vid', async (req, res) => {
  try {
    const r = await load(req.params.token);
    if (!r) return res.status(404).send('Not found');
    const v = await db.one(
      `SELECT v.*, f.* , v.id AS vid FROM proof_versions v JOIN files f ON f.id = v.file_id
       WHERE v.id = $1 AND v.request_id = $2 ${isPreview(req) || req.user ? '' : 'AND v.sent_at IS NOT NULL'}`,
      [parseInt(req.params.vid, 10), r.id]
    );
    if (!v) return res.status(404).send('Not found');
    const { stream } = await dropbox.download(v);
    res.setHeader('Content-Type', v.mime || dropbox.guessMime(v.name));
    res.setHeader('Content-Disposition', `${req.query.download ? 'attachment' : 'inline'}; filename="${encodeURIComponent(v.name)}"`);
    res.setHeader('Cache-Control', 'private, max-age=300');
    stream.on('error', () => res.end());
    stream.pipe(res);
  } catch (e) {
    console.error('public file', e);
    res.status(502).send('Could not load the proof file.');
  }
});

router.post('/api/public/:token/respond', express.json(), async (req, res) => {
  try {
    let r = await load(req.params.token);
    if (!r) return res.status(404).json({ error: 'Proof not found' });
    const { versionId, action } = req.body;
    const name = String(req.body.name || '').trim().slice(0, 120);
    const comment = String(req.body.comment || '').trim().slice(0, 5000);
    const acknowledged = Array.isArray(req.body.acknowledged) ? req.body.acknowledged.map(String) : [];

    const target = await db.one('SELECT * FROM proof_versions WHERE id = $1 AND request_id = $2', [Number(versionId), r.id]);
    if (!target) return res.status(404).json({ error: 'Proof not found' });
    const latest = await db.one('SELECT * FROM proof_versions WHERE item_id = $1 AND sent_at IS NOT NULL ORDER BY version DESC LIMIT 1', [target.item_id]);
    if (!latest || latest.id !== target.id) return res.status(409).json({ error: 'A newer version of this proof is available. Please refresh the page.' });
    if (await db.one('SELECT 1 FROM responses WHERE version_id = $1', [latest.id])) {
      return res.status(409).json({ error: 'This version already has a response.' });
    }
    if (!['approved', 'changes'].includes(action)) return res.status(400).json({ error: 'Unknown action' });
    if (!name) return res.status(400).json({ error: 'Please enter your name.' });
    if (action === 'approved') {
      const required = (latest.warnings || []).map((w) => w.key);
      if (required.some((k) => !acknowledged.includes(k))) return res.status(400).json({ error: 'Please check off each note before approving.' });
    } else if (!comment) {
      return res.status(400).json({ error: 'Tell us what you would like changed.' });
    }

    await db.q(
      `INSERT INTO responses(request_id, version_id, action, signer_name, comment, acknowledged, ip, user_agent)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [r.id, latest.id, action, name, comment || null, JSON.stringify(acknowledged), req.ip, String(req.headers['user-agent'] || '').slice(0, 300)]
    );

    const item = await db.one('SELECT * FROM request_items WHERE id = $1', [latest.item_id]);
    const label = `${wf.itemLabel(item)}${item.color_name ? ` (${item.color_name})` : ''} v${latest.version}`;
    const [rep, artist] = await Promise.all([
      r.rep_id ? db.one('SELECT * FROM users WHERE id = $1', [r.rep_id]) : null,
      r.artist_id ? db.one('SELECT * FROM users WHERE id = $1', [r.artist_id]) : null,
    ]);
    const staff = [rep, artist].filter(Boolean).map((u) => u.email).filter((v, i, a) => a.indexOf(v) === i);
    const link = wf.appRequestUrl(r);

    push.notify([r.rep_id, r.artist_id], 'client_response', {
      title: action === 'approved' ? `✅ Approved: ${r.job_name}` : `✏️ Changes requested: ${r.job_name}`,
      body: `${name} · ${label}${comment ? ` — ${comment}` : ''}`.slice(0, 180),
      url: link,
    });
    if (action === 'approved') {
      await wf.log(r.id, { actor: name, kind: 'client', body: `approved ${label}${comment ? `: ${comment}` : ''}` });
      r = await wf.recomputeStatus(r, { actor: name });
      const allDone = r.status === 'approved';
      notify.missivePost(r.missive_conversation_id, {
        title: allDone ? `All proofs approved: ${r.job_name}` : `Proof approved: ${r.job_name}`,
        body: `${name} approved ${label}`,
        markdown: `✅ **${label} approved** by ${name} on [${r.job_name}](${link})${allDone ? ' — **all products approved, ready for production.**' : ''}${comment ? `\n\n> ${comment}` : ''}`,
      });
      notify.notifyStaffEmail(staff.join(','), `${allDone ? 'All approved' : 'Approved'}: ${r.job_name}`,
        `<p><strong>${notify.esc(name)}</strong> approved <strong>${notify.esc(label)}</strong> for ${notify.esc(r.job_name)}.${allDone ? ' Every product is approved and the job is in Ready for Production.' : ''}</p>
         ${comment ? `<p style="white-space:pre-wrap;background:#f6f3f0;padding:12px;border-radius:6px;">${notify.esc(comment)}</p>` : ''}
         <p>${notify.button(link, 'Open request')}</p>`);
      // APPROVED copy + approval record in Proofs/Approved; superseded files move to Proofs/Old Versions.
      await proofFiles.onApproved(r, latest, item, { name, comment, ip: req.ip });
    } else {
      await wf.log(r.id, { actor: name, kind: 'client', body: `requested changes on ${label}: ${comment}` });
      r = await wf.recomputeStatus(r, { actor: name });
      notify.missivePost(r.missive_conversation_id, {
        title: `Changes requested: ${r.job_name}`,
        body: `${name} on ${label}: ${comment}`,
        markdown: `✏️ **Changes requested** on ${label} for [${r.job_name}](${link}) by ${name}\n\n> ${comment.replace(/\n/g, '\n> ')}`,
      });
      notify.notifyStaffEmail(staff.join(','), `Changes requested: ${r.job_name}`,
        `<p><strong>${notify.esc(name)}</strong> requested changes on <strong>${notify.esc(label)}</strong> for ${notify.esc(r.job_name)}:</p>
         <p style="white-space:pre-wrap;background:#fff4e5;padding:12px;border-radius:6px;">${notify.esc(comment)}</p>
         <p>${notify.button(link, 'Open request')}</p>`);
    }
    res.json({ ok: true });
  } catch (e) {
    console.error('respond', e);
    res.status(500).json({ error: 'Something went wrong. Please try again or reply to the proof email.' });
  }
});

module.exports = router;

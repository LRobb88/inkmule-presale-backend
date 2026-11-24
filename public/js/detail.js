// Request detail view — used by /requests/:id and the Missive sidebar.
// Each product has its own artwork, proof versions, sales review and client approval.
(function () {
  const { esc, api } = IM;

  function fileRow(f) {
    if (!f) return '';
    return `<div class="file"><span class="name" title="${esc(f.name)}">${esc(f.name)}</span>
      <a class="btn btn-sm" href="${esc(f.url)}" target="_blank" rel="noopener">Open</a>
      ${f.dropboxUrl ? `<a class="btn btn-sm" href="${esc(f.dropboxUrl)}" target="_blank" rel="noopener">Dropbox</a>` : ''}</div>`;
  }

  function versionHtml(v, r, item, isLatest) {
    const others = (v.batch_items || []).filter((id) => id !== item.id).map((id) => r.items.find((i) => i.id === id)).filter(Boolean);
    const review = v.sales_review_required ? (
      v.sales_review_status === 'pending'
        ? `<div class="callout warn" style="margin-top:8px"><strong>Needs sales review</strong>${r.rep_name ? ` — ${esc(r.rep_name)}` : ''}\n${IM.linkify(v.sales_review_note)}</div>
           ${isLatest ? `<div class="row wrap" style="margin-top:8px"><button class="btn-primary btn-sm" data-act="review-ok" data-batch="${esc(v.batch_id)}">Approve to send</button><button class="btn-sm" data-act="review-back" data-batch="${esc(v.batch_id)}">Send back to art</button>${others.length ? `<span class="small muted">Also applies to ${esc(others.map((o) => o.label).join(', '))}</span>` : ''}</div>` : ''}`
        : `<div class="callout ${v.sales_review_status === 'approved' ? 'ok' : 'bad'}" style="margin-top:8px"><strong>${v.sales_review_status === 'approved' ? 'Cleared by sales' : 'Sent back by sales'}</strong>${v.sales_review_by_name ? ` (${esc(v.sales_review_by_name)})` : ''}\nArtist: ${IM.linkify(v.sales_review_note)}${v.sales_review_reply ? `\nSales: ${IM.linkify(v.sales_review_reply)}` : ''}</div>`
    ) : '';
    const sent = v.sent_at
      ? `<span class="badge teal">${v.sent_via === 'email' ? 'Emailed' : 'Link shared'} ${IM.ago(v.sent_at)}</span>${!v.responses.length ? (v.client_viewed_at ? ` <span class="badge ok">Viewed ${IM.ago(v.client_viewed_at)}</span>` : ' <span class="badge">Not opened yet</span>') : ''}`
      : '<span class="badge">Not sent</span>';
    const responses = (v.responses || []).map((x) => `<div class="callout ${x.action === 'approved' ? 'ok' : 'bad'}" style="margin-top:8px"><strong>${x.action === 'approved' ? '✓ Approved' : 'Changes requested'}</strong> by ${esc(x.signer_name)} · ${IM.ago(x.created_at)}${x.comment ? `\n${IM.linkify(x.comment)}` : ''}</div>`).join('')
      + (v.approved_file ? `<div style="margin-top:8px"><div class="small" style="font-weight:600;color:var(--ok);margin-bottom:4px">Final approved file (Proofs/Approved)</div>${fileRow(v.approved_file)}</div>` : '');
    if (!isLatest) {
      return `<details class="version" style="padding:10px 14px"><summary class="small"><strong>v${v.version}</strong> · ${esc(v.file ? v.file.name : '')} · ${v.responses[0] ? (v.responses[0].action === 'approved' ? 'approved' : 'changes requested') : v.sent_at ? 'sent' : 'not sent'} · ${IM.ago(v.created_at)}</summary>
        <div style="margin-top:8px">${fileRow(v.file)}</div>${responses}</details>`;
    }
    return `<div class="version latest">
      <div class="row wrap"><strong>${item.source === 'design' ? 'Version' : 'Proof v'}${item.source === 'design' ? ' ' : ''}${v.version}</strong> ${sent}<div class="spacer"></div><span class="small muted">${esc(v.created_by_name || '')} · ${IM.ago(v.created_at)}</span></div>
      <div style="margin-top:8px">${fileRow(v.file)}</div>
      ${others.length ? `<div class="small muted" style="margin-top:4px">Same file also used for ${esc(others.map((o) => o.label).join(', '))}</div>` : ''}
      ${v.warnings.length ? `<ul class="warnlist">${v.warnings.map((w) => `<li>⚠ ${esc(w.text)}</li>`).join('')}</ul>` : ''}
      ${v.artist_note ? `<div class="small" style="margin-top:6px"><span class="muted">Note to client:</span> ${IM.linkify(v.artist_note)}</div>` : ''}
      ${review}${responses}
    </div>`;
  }

  function designItemHtml(it, r) {
    const latest = it.versions[0];
    const canAdd = !latest || latest.sales_review_status !== 'pending';
    return `<div class="card pad" data-item="${it.id}">
      <div class="row wrap"><span class="badge teal">Design / mockup</span><strong style="font-size:15px">${esc(it.product_type)}</strong><div class="spacer"></div>${it.versions.length ? IM.itemStateBadge(it.state) : ''}</div>
      ${it.item_notes ? `<div class="small" style="margin-top:6px"><span class="muted">Products / placement:</span> ${IM.linkify(it.item_notes)}</div>` : ''}
      <div style="margin-top:12px">
        <div class="row" style="margin-bottom:6px"><h3>Reference files</h3><div class="spacer"></div><button class="btn-ghost btn-sm" data-act="add-art">+ Add files</button></div>
        <div class="files">${r.artwork.length ? r.artwork.map(fileRow).join('') : '<div class="muted small">No reference files.</div>'}</div>
      </div>
      <div style="margin-top:14px">
        <div class="row" style="margin-bottom:8px"><h3>Artist's files</h3><div class="spacer"></div>
          ${canAdd ? `<button class="btn-orange btn-sm" data-act="add-proof" data-item="${it.id}">+ ${latest ? 'New version' : 'Add file'}</button>` : ''}</div>
        ${it.versions.length ? it.versions.map((v, i) => versionHtml(v, r, it, i === 0)).join('') : '<div class="muted small">Nothing yet. Add the mockup or design here — it can stay internal, or be sent to the client for approval.</div>'}
      </div>
    </div>`;
  }

  function colorsHtml(g) {
    const cs = Array.isArray(g.colors) ? g.colors : [];
    const sw = (c) => `<span class="swatch" style="${c.swatch ? `background-image:url('${esc(c.swatch)}')` : `background:${esc(c.hex ? (c.hex.startsWith('#') ? c.hex : '#' + c.hex) : '#ddd')}`}"></span>`;
    if (cs.length > 1) return `<span class="chips" style="display:inline-flex">${cs.map((c) => `<span class="chip" style="cursor:default;padding:2px 9px 2px 4px">${sw(c)}${esc(c.name)}</span>`).join('')}</span>`;
    return `${sw(cs[0] || { swatch: g.swatch_url, hex: g.color_hex })} ${esc(g.color_name)}`;
  }
  // Extra garments that run together with this product's print.
  function extraGarmentsHtml(it) {
    const gs = Array.isArray(it.garments) ? it.garments : [];
    if (!gs.length) return '';
    return gs.map((g) => `<div class="product" style="padding:10px 0 0;border-top:1px dashed #e4e0dd;margin-top:10px">
      <div class="pimg" style="width:60px;height:60px;${g.image_url ? `background-image:url('${esc(g.image_url)}')` : ''}">${g.image_url ? '' : `<div class="small muted" style="padding:18px 4px;text-align:center">${esc(g.product_type || '')}</div>`}</div>
      <div style="flex:1;min-width:0">
        <div><strong>${esc([g.brand, g.style].filter(Boolean).join(' ') || g.title)}</strong> ${g.source === 'ss' ? '<span class="badge teal">S&amp;S</span>' : ''} <span class="small muted">· same print</span></div>
        ${g.title && g.style ? `<div class="small muted">${esc(g.title)}</div>` : ''}
        <div style="margin-top:4px">${colorsHtml(g)} · ${esc(g.product_type)}</div>
        <div class="row wrap" style="margin-top:6px">${g.vendor_url ? `<a class="btn btn-sm" href="${esc(g.vendor_url)}" target="_blank" rel="noopener">Vendor page ↗</a>` : ''}
          ${g.image_url ? `<a class="btn btn-sm" href="${esc(g.image_url)}" target="_blank" rel="noopener">Front image</a>` : ''}
          ${g.back_image_url ? `<a class="btn btn-sm" href="${esc(g.back_image_url)}" target="_blank" rel="noopener">Back view</a>` : ''}</div>
      </div></div>`).join('');
  }
  // Decoration details for a product (shown once, even when several garments share the print).
  function printHtml(it) {
    return `
          <div style="margin-top:4px"><strong>${esc(it.decoration_type)}</strong>${it.sp_options.length ? ` (${esc(it.sp_options.join(', '))})` : ''} — ${esc(it.locations.join(', '))}</div>
          ${it.decorator ? `<div class="small">Decorator: <strong>${esc(it.decorator)}</strong></div>` : ''}
          ${it.print_colors ? `<div class="small">Ink: ${esc(it.print_colors)}</div>` : ''}
          ${it.item_notes ? `<div class="small muted">${IM.linkify(it.item_notes)}</div>` : ''}
`;
  }

  function itemHtml(it, r) {
    if (it.source === 'design') return designItemHtml(it, r);
    const img = it.image_url ? `background-image:url('${esc(it.image_url)}')` : '';
    const sw = it.swatch_url ? `background-image:url('${esc(it.swatch_url)}')` : `background:${esc(it.color_hex || '#ddd')}`;
    const latest = it.versions[0];
    const canAdd = !latest || latest.sales_review_status !== 'pending';
    const fileName = IM.productFileName(r.job_name, it.subname);
    return `<div class="card pad" data-item="${it.id}">
      <div class="row wrap filename-bar">
        <span class="small muted">File name</span><code style="font-size:14px;font-weight:600">${esc(fileName)}</code>
        <button class="btn-sm" data-act="copy-filename" data-name="${esc(fileName)}">Copy</button>
        ${!it.subname && r.items.length > 1 ? '<span class="small muted">Add a subname (Edit) to tell products apart</span>' : ''}
      </div>
      <div class="product" style="padding-top:0">
        <div class="pimg" style="${img}">${it.image_url ? '' : `<div class="small muted" style="padding:28px 6px;text-align:center">${esc(it.product_type || '')}</div>`}</div>
        <div style="flex:1;min-width:0">
          <div class="row wrap"><strong style="font-size:15px">${esc(it.label)}</strong> ${it.source === 'ss' ? '<span class="badge teal">S&amp;S</span>' : ''}<div class="spacer"></div>${IM.itemStateBadge(it.state)}
            <button class="btn-ghost btn-sm" data-act="edit-item" data-item="${it.id}">Edit</button>
            ${!it.versions.length && r.items.length > 1 ? `<button class="btn-ghost btn-sm btn-danger" data-act="remove-item" data-item="${it.id}">Remove</button>` : ''}</div>
          ${it.title && it.style ? `<div class="small muted">${esc(it.title)}</div>` : ''}
          ${(it.garments || []).length ? `<div style="margin-top:2px"><span class="badge teal">${it.garments.length + 1} garments · one print · one proof</span></div>` : ''}
          <div style="margin-top:4px">${colorsHtml(it)} · ${esc(it.product_type)}</div>
          ${(it.garments || []).length ? '' : printHtml(it)}
          <div class="row wrap" style="margin-top:6px">
            ${it.vendor_url ? `<a class="btn btn-sm" href="${esc(it.vendor_url)}" target="_blank" rel="noopener">Vendor page ↗</a>` : ''}
            ${it.image_url ? `<a class="btn btn-sm" href="${esc(it.image_url)}" target="_blank" rel="noopener">Front image</a>` : ''}
            ${it.back_image_url ? `<a class="btn btn-sm" href="${esc(it.back_image_url)}" target="_blank" rel="noopener">Back view</a>` : ''}
          </div>
        </div>
      </div>
      ${extraGarmentsHtml(it)}
      ${(it.garments || []).length ? `<div style="margin-top:10px;padding-top:10px;border-top:1px dashed #e4e0dd"><div class="small muted" style="margin-bottom:2px">Print (all garments above)</div>${printHtml(it)}</div>` : ''}
      <div style="margin-top:12px">
        <div class="row" style="margin-bottom:6px"><h3>Artwork</h3><div class="spacer"></div><button class="btn-ghost btn-sm" data-act="add-art" data-item="${it.id}">+ Add files</button></div>
        <div class="files">${it.artwork.length ? it.artwork.map(fileRow).join('') : '<div class="muted small">None for this product — see job artwork below.</div>'}</div>
      </div>
      <div style="margin-top:14px">
        <div class="row" style="margin-bottom:8px"><h3>Proofs</h3><div class="spacer"></div>
          ${canAdd ? `<button class="btn-orange btn-sm" data-act="add-proof" data-item="${it.id}">+ ${latest ? 'New version' : 'Add proof'}</button>` : ''}</div>
        ${it.versions.length ? it.versions.map((v, i) => versionHtml(v, r, it, i === 0)).join('') : '<div class="muted small">No proof yet.</div>'}
      </div>
    </div>`;
  }

  function activityHtml(a) {
    const who = a.user_name || a.actor || 'System';
    if (a.kind === 'comment') {
      return `<li>${IM.avatar(who, a.user_picture)}<div style="flex:1;min-width:0"><strong>${esc(who)}</strong> <span class="when">${IM.ago(a.created_at)}</span><div class="comment">${IM.linkify(a.body)}</div></div></li>`;
    }
    const body = a.body.charAt(0).toLowerCase() + a.body.slice(1);
    return `<li>${IM.avatar(who, a.user_picture)}<div style="flex:1;min-width:0"><span>${esc(who)}</span> <span class="muted">${IM.linkify(body)}</span><div class="when">${IM.ago(a.created_at)}</div></div></li>`;
  }

  // ---- Add proof (artist) ----
  async function proofModal(r, preselect, onDone) {
    const meta = await IM.meta(true);
    const blocked = (it) => it.versions[0] && it.versions[0].sales_review_status === 'pending';
    IM.modal(`
      <h2>Add proof</h2>
      <div class="stack">
        <div>
          <span class="label req">Which product(s) is this proof for?</span>
          <div class="stack" style="margin-top:6px">${r.items.map((it) => `<label class="row" style="gap:8px;cursor:pointer;${blocked(it) ? 'opacity:.5' : ''}"><input type="checkbox" class="p-item" value="${it.id}" ${it.id === preselect ? 'checked' : ''} ${blocked(it) ? 'disabled' : ''}>
            <span>${it.subname ? `<code>${esc(IM.productFileName(r.job_name, it.subname))}</code> ` : ''}<strong>${esc(it.label)}</strong> <span class="muted">${esc(it.color_name)}</span> — ${it.versions.length ? `will be v${it.versions[0].version + 1}` : 'v1'}${blocked(it) ? ' (waiting on sales review)' : ''}</span></label>`).join('')}</div>
          ${r.items.length > 1 ? '<div class="hint">Tick more than one if a single file shows several products. The client still approves each product separately.</div>' : ''}
        </div>
        <div class="tabs"><button type="button" class="on" data-m="link">Paste Dropbox link</button><button type="button" data-m="file">Upload file</button></div>
        <div data-pane="link"><input type="url" class="p-link" placeholder="https://www.dropbox.com/scl/fi/…"><div class="hint">It'll be copied into <code>${esc(r.dropbox_folder || '')}/Proofs</code> if it isn't there already.</div></div>
        <div data-pane="file" class="hidden"><div class="dropzone p-drop">Drop the proof PDF/image here or <u>browse</u></div><input type="file" class="hidden p-file" accept=".pdf,.png,.jpg,.jpeg,.gif,.webp"><div class="p-fname small" style="margin-top:6px"></div></div>
        <div>
          <span class="label">Warnings for the client <span class="muted" style="font-weight:400">— they'll have to check each one off before approving</span></span>
          <div class="stack" style="margin-top:6px">${meta.warnings.map((w) => `<label class="row" style="align-items:flex-start;gap:8px;cursor:pointer"><input type="checkbox" value="${esc(w.key)}" class="p-warn" style="margin-top:3px"><span>${esc(w.text)}</span></label>`).join('')}
            <input type="text" class="p-other" placeholder="Other warning (optional)"></div>
        </div>
        <label class="field"><span>Note to client (optional)</span><textarea class="p-note" placeholder="Shown on the proof page"></textarea></label>
        <div class="card" style="padding:12px;box-shadow:none;background:var(--orange-tint);border-color:#f5cfb5">
          <label class="row" style="cursor:pointer;gap:8px"><input type="checkbox" class="p-review"><strong>Require sales review before this goes to the client</strong></label>
          <div class="p-review-box hidden" style="margin-top:8px">
            <textarea class="p-review-note" placeholder="What does ${esc(r.rep_name || 'the rep')} need to look at?"></textarea>
            <div class="hint">${esc(r.rep_name || 'The rep')} gets an email and a note in the Missive conversation.</div>
          </div>
        </div>
        <div class="err p-err"></div>
      </div>
      <div class="actions"><button data-close>Cancel</button><button class="btn-primary p-save">Save proof</button></div>`, {
      onMount(m, close) {
        let mode = 'link', file = null;
        m.querySelectorAll('[data-m]').forEach((b) => (b.onclick = () => {
          mode = b.dataset.m;
          m.querySelectorAll('[data-m]').forEach((x) => x.classList.toggle('on', x === b));
          m.querySelectorAll('[data-pane]').forEach((p) => p.classList.toggle('hidden', p.dataset.pane !== mode));
        }));
        const drop = m.querySelector('.p-drop'), input = m.querySelector('.p-file'), fname = m.querySelector('.p-fname');
        const setFile = (f) => { file = f; fname.textContent = f ? `${f.name} (${(f.size / 1048576).toFixed(1)} MB)` : ''; };
        drop.onclick = () => input.click();
        input.onchange = () => setFile(input.files[0]);
        drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('over'); });
        drop.addEventListener('dragleave', () => drop.classList.remove('over'));
        drop.addEventListener('drop', (e) => { e.preventDefault(); drop.classList.remove('over'); setFile(e.dataTransfer.files[0]); });
        const review = m.querySelector('.p-review');
        review.onchange = () => m.querySelector('.p-review-box').classList.toggle('hidden', !review.checked);
        m.querySelector('.p-save').onclick = async (e) => {
          const err = m.querySelector('.p-err');
          err.textContent = '';
          const itemIds = [...m.querySelectorAll('.p-item:checked')].map((c) => +c.value);
          if (!itemIds.length) return (err.textContent = 'Choose which product(s) this proof is for.');
          const fd = new FormData();
          fd.append('item_ids', JSON.stringify(itemIds));
          if (mode === 'link') {
            const link = m.querySelector('.p-link').value.trim();
            if (!link) return (err.textContent = 'Paste the Dropbox link to the proof.');
            fd.append('link', link);
          } else {
            if (!file) return (err.textContent = 'Choose the proof file.');
            fd.append('file', file, file.name);
          }
          fd.append('warnings', JSON.stringify([...m.querySelectorAll('.p-warn:checked')].map((c) => c.value)));
          fd.append('other_warning', m.querySelector('.p-other').value);
          fd.append('artist_note', m.querySelector('.p-note').value);
          fd.append('sales_review_required', review.checked ? 'true' : 'false');
          fd.append('sales_review_note', m.querySelector('.p-review-note').value);
          if (review.checked && !m.querySelector('.p-review-note').value.trim()) return (err.textContent = 'Tell the rep what needs review.');
          try {
            const res = await IM.busy(e.currentTarget, () => api(`/api/requests/${r.id}/proofs`, { method: 'POST', body: fd }));
            close();
            IM.toast(review.checked ? 'Saved — sent to sales for review' : 'Proof saved — ready to send');
            onDone(res.request);
          } catch (x) { err.textContent = x.message; }
        };
      },
    });
  }

  function readyList(r) {
    return r.items.filter((it) => it.state === 'ready').map((it) => `${it.label} (${it.color_name}) — v${it.versions[0].version}`);
  }

  function sendModal(r, onDone) {
    const ready = readyList(r);
    const reminder = !ready.length;
    const waiting = r.items.filter((it) => ['none', 'review', 'returned'].includes(it.state));
    IM.modal(`
      <h2>${reminder ? 'Re-send proof link' : 'Email proofs to the client'}</h2>
      <div class="stack">
        <div class="kv"><dt>To</dt><dd>${esc(r.client_email)}</dd>${r.cc_emails ? `<dt>CC</dt><dd>${esc(r.cc_emails)}</dd>` : ''}<dt>Reply-to</dt><dd>${esc(r.rep_name || r.rep_email || 'you')}</dd></div>
        ${reminder ? '<div class="callout info">Nothing new is ready, so this sends a reminder with the link to the proofs they already have.</div>'
          : `<div><span class="label">Included</span><ul style="margin:4px 0 0;padding-left:18px">${ready.map((x) => `<li>${esc(x)}</li>`).join('')}</ul></div>`}
        ${!reminder && waiting.length ? `<div class="callout warn">Not included yet: ${esc(waiting.map((w) => `${w.label} (${IM.ITEM_STATES[w.state][0].toLowerCase()})`).join(', '))}. You can send those later — the client's link will update.</div>` : ''}
        <label class="field"><span>Message (optional)</span><textarea class="s-msg" placeholder="Added above the Review button"></textarea></label>
        <div class="err s-err"></div>
      </div>
      <div class="actions"><button data-close>Cancel</button><button class="btn-primary s-go">Send email</button></div>`, {
      onMount(m, close) {
        m.querySelector('.s-go').onclick = async (e) => {
          try {
            const res = await IM.busy(e.currentTarget, () => api(`/api/requests/${r.id}/send`, { body: { message: m.querySelector('.s-msg').value } }));
            close();
            IM.toast(`Emailed ${r.client_email}`);
            onDone(res.request);
          } catch (x) { m.querySelector('.s-err').textContent = x.message; }
        };
      },
    });
  }

  function reviewModal(r, batch, decision, onDone) {
    const vs = r.items.flatMap((it) => it.versions.filter((v) => v.batch_id === batch && v.sales_review_status === 'pending').map((v) => ({ it, v })));
    const note = vs[0] ? vs[0].v.sales_review_note : '';
    IM.modal(`
      <h2>${decision === 'approved' ? 'Approve to send' : 'Send back to art'}</h2>
      <div class="small muted" style="margin-bottom:8px">${esc(vs.map((x) => `${x.it.label} v${x.v.version}`).join(', '))}</div>
      <div class="callout warn">${IM.linkify(note)}</div>
      <label class="field" style="margin-top:12px"><span class="${decision === 'approved' ? '' : 'req'}">Note for the artist</span><textarea class="r-msg"></textarea></label>
      <div class="err r-err"></div>
      <div class="actions"><button data-close>Cancel</button><button class="btn-primary r-go">${decision === 'approved' ? 'Approve' : 'Send back'}</button></div>`, {
      onMount(m, close) {
        m.querySelector('.r-go').onclick = async (e) => {
          try {
            const res = await IM.busy(e.currentTarget, () => api(`/api/requests/${r.id}/batches/${encodeURIComponent(batch)}/review`, { body: { decision, reply: m.querySelector('.r-msg').value } }));
            close();
            IM.toast(decision === 'approved' ? 'Cleared — ready to send' : 'Sent back to art');
            onDone(res.request);
          } catch (x) { m.querySelector('.r-err').textContent = x.message; }
        };
      },
    });
  }

  function clientModal(r, onDone) {
    IM.modal(`
      <h2>Edit job details</h2>
      <div class="stack">
        <label class="field"><span class="req">Job name</span><input type="text" class="c-job" value="${esc(r.job_name)}"><div class="hint">Changing it also renames the Dropbox folder.</div></label>
        ${r.kind === 'design' ? `<div class="grid2"><label class="field"><span>Type of work</span><input type="text" class="c-work" value="${esc(r.items[0] ? r.items[0].product_type : '')}"></label>
          <label class="field"><span>Products / placement</span><input type="text" class="c-ctx" value="${esc(r.items[0] ? r.items[0].item_notes || '' : '')}"></label></div>` : ''}
        <label class="field"><span class="${r.kind === 'design' ? '' : 'req'}">Client email</span><input type="email" class="c-email" value="${esc(r.client_email || '')}"></label>
        <div class="grid2"><label class="field"><span>Name</span><input type="text" class="c-name" value="${esc(r.client_name || '')}"></label>
        <label class="field"><span>Company</span><input type="text" class="c-co" value="${esc(r.client_company || '')}"></label></div>
        <label class="field"><span>CC on proof emails</span><input type="text" class="c-cc" value="${esc(r.cc_emails || '')}"></label>
        <label class="field"><span>Notes for the art team</span><textarea class="c-notes">${esc(r.notes || '')}</textarea></label>
        <div class="err c-err"></div>
      </div>
      <div class="actions"><button data-close>Cancel</button><button class="btn-primary c-go">Save</button></div>`, {
      onMount(m, close) {
        m.querySelector('.c-go').onclick = async (e) => {
          try {
            const res = await IM.busy(e.currentTarget, () => api(`/api/requests/${r.id}`, { method: 'PATCH', body: {
              job_name: m.querySelector('.c-job').value.trim(),
              ...(r.kind === 'design' ? { work_type: m.querySelector('.c-work').value.trim(), product_context: m.querySelector('.c-ctx').value.trim() } : {}),
              client_email: m.querySelector('.c-email').value.trim(), client_name: m.querySelector('.c-name').value.trim(),
              client_company: m.querySelector('.c-co').value.trim(), cc_emails: m.querySelector('.c-cc').value.trim(), notes: m.querySelector('.c-notes').value,
            } }));
            close();
            onDone(res.request);
          } catch (x) { m.querySelector('.c-err').textContent = x.message; }
        };
      },
    });
  }

  async function itemModal(r, it, onDone) {
    const editor = await IM.ItemEditor(it, { jobName: r.job_name });
    IM.modal(`<h2>${it ? `Edit ${esc(it.label)}` : 'Add a product'}</h2>
      ${it && it.versions.length ? '<div class="callout warn" style="margin-bottom:10px">This product already has a proof. The artist will be notified of your changes.</div>' : ''}
      <div class="i-body"></div><div class="err i-err" style="margin-top:8px"></div>
      <div class="actions"><button data-close>Cancel</button><button class="btn-primary i-go">${it ? 'Save changes' : 'Add product'}</button></div>`, {
      onMount(m, close) {
        m.style.maxWidth = '720px';
        m.querySelector('.i-body').appendChild(editor.el);
        m.querySelector('.i-go').onclick = async (e) => {
          const err = m.querySelector('.i-err');
          err.textContent = '';
          let data;
          try { data = editor.collect(); } catch (x) { err.textContent = x.message; return; }
          try {
            let res = await IM.busy(e.currentTarget, () => it
              ? api(`/api/requests/${r.id}/items/${it.id}`, { method: 'PATCH', body: { item: data.item } })
              : api(`/api/requests/${r.id}/items`, { body: { item: data.item } }));
            const itemId = it ? it.id : res.itemId;
            if (data.files.length) {
              const fd = new FormData();
              data.files.forEach((f) => fd.append('artwork', f, f.name));
              fd.append('item_id', itemId);
              res = await api(`/api/requests/${r.id}/artwork`, { method: 'POST', body: fd });
            }
            close();
            IM.toast(it ? 'Product updated' : 'Product added');
            onDone(res.request);
          } catch (x) { err.textContent = x.message; }
        };
      },
    });
  }

  IM.RequestDetail = async function RequestDetail(container, id, { compact, openExternal } = {}) {
    const meta = await IM.meta();
    let r = (await api(`/api/requests/${id}`)).request;
    const open = openExternal || ((url) => window.open(url, '_blank', 'noopener'));
    let artItem = null;

    function render() {
      const s = r.summary;
      const readyN = s.ready;
      const anyOut = s.awaiting + s.approved + s.changes > 0;
      container.innerHTML = `
        <div class="detail">
          <div class="stack">
            <div class="card pad">
              <div class="row wrap" style="align-items:flex-start">
                <div style="flex:1;min-width:200px">
                  <h1>${esc(r.job_name)}</h1>
                  <div class="muted" style="margin-top:4px">${esc([r.client_name, r.client_company].filter(Boolean).join(' · '))} ${r.client_name || r.client_company ? '·' : ''} ${r.client_email ? esc(r.client_email) : (r.kind === 'design' ? 'Internal — no client yet' : '')}${r.cc_emails ? ` <span class="small">(cc ${esc(r.cc_emails)})</span>` : ''}
                    <button class="btn-ghost btn-sm" data-act="edit-client">Edit</button></div>
                </div>
                <select class="status-select" style="width:auto">${meta.statuses.map((x) => `<option value="${x.key}" ${x.key === r.status ? 'selected' : ''}>${esc(x.label)}</option>`).join('')}</select>
              </div>
              ${r.notes ? `<div class="callout info" style="margin-top:12px">${r.kind === 'design' ? '<strong>What\'s needed</strong>\n' : ''}${IM.linkify(r.notes)}</div>` : ''}
              <div class="row wrap" style="margin-top:14px;padding-top:12px;border-top:1px solid #f0edeb">
                <div class="row wrap" style="flex:1">${IM.proofHint(r) || '<span class="small muted">No proofs yet</span>'}</div>
                ${(readyN || anyOut) && !r.client_email ? '<span class="small muted">Add a client email (Edit) to send this to them.</span>' : ''}
                ${(readyN || anyOut) && r.client_email ? `<button class="btn-primary btn-sm" data-act="send">${readyN ? `Send to client (${readyN})` : 'Re-send link'}</button>` : ''}
                ${readyN || anyOut ? `<button class="btn-sm" data-act="link">Copy live link</button>` : ''}
                <a class="btn btn-sm btn-ghost" href="/p/${esc(r.public_token)}?preview=1" target="_blank" rel="noopener">Preview as client ↗</a>
              </div>
            </div>

            ${r.items.map((it) => itemHtml(it, r)).join('')}
            ${r.kind === 'design' ? '' : '<div><button data-act="add-item">+ Add a product</button></div>'}

            <div class="card pad ${r.kind === 'design' ? 'design-folder' : ''}">
              <div class="row" style="margin-bottom:10px"><h2>${r.kind === 'design' ? 'Dropbox' : 'Artwork for the whole job'}</h2><div class="spacer"></div>
                ${r.dropbox_folder_url ? `<a class="btn btn-sm" href="${esc(r.dropbox_folder_url)}" target="_blank" rel="noopener">Open Dropbox folder ↗</a>` : ''}
                ${r.kind === 'design' ? '' : '<button class="btn-sm" data-act="add-art">+ Add files</button>'}</div>
              ${r.kind === 'design' ? '' : `<div class="files">${r.artwork.length ? r.artwork.map(fileRow).join('') : '<div class="muted small">No job-wide artwork.</div>'}</div>`}
              <div class="small muted" style="margin-top:8px">Dropbox: <code>${esc(r.dropbox_folder || '')}</code></div>
              <input type="file" multiple class="hidden art-input">
            </div>
          </div>

          <div class="stack">
            <div class="card pad">
              <dl class="kv">
                <dt>Status</dt><dd>${IM.statusBadge(r.status, r.status_label)}</dd>
                <dt>Rep</dt><dd>${esc(r.rep_name || r.rep_email || '—')}</dd>
                <dt>Artist</dt><dd><select class="artist-select"><option value="">Unassigned</option>${meta.users.map((u) => `<option value="${u.id}" ${u.id === r.artist_id ? 'selected' : ''}>${esc(u.name || u.email)}</option>`).join('')}</select></dd>
                <dt>Proof due</dt><dd><input type="date" class="due-input" value="${esc(IM.dateOnly(r.due_date))}"></dd>
                <dt>Created</dt><dd>${IM.fmtDate(r.created_at, { month: 'short', day: 'numeric', year: 'numeric' })}</dd>
                ${!compact ? `<dt>Missive</dt><dd>${r.missive_conversation_id ? `<a href="https://mail.missiveapp.com/#inbox/conversations/${esc(r.missive_conversation_id)}" target="_blank" rel="noopener">Open conversation ↗</a>` : '<span class="muted small">Not linked</span>'}</dd>` : `<dt>Web app</dt><dd><a href="#" data-act="open-web">Open full view ↗</a></dd>`}
              </dl>
            </div>
            <div class="card pad">
              <h2 style="margin-bottom:8px">Activity</h2>
              <div class="row" style="align-items:flex-end;margin-bottom:6px"><textarea class="comment-box" placeholder="Comment for the team…" style="min-height:40px"></textarea><button class="btn-sm" data-act="comment">Post</button></div>
              <ul class="activity">${r.activity.map(activityHtml).join('')}</ul>
            </div>
          </div>
        </div>`;
      wire();
    }

    const update = (next) => { r = next; render(); };
    const patch = async (body) => {
      try { update((await api(`/api/requests/${r.id}`, { method: 'PATCH', body })).request); IM.toast('Saved'); } catch (e) { IM.toast(e.message, true); render(); }
    };

    function wire() {
      const $ = (sel) => container.querySelector(sel);
      $('.status-select').onchange = (e) => patch({ status: e.target.value });
      $('.artist-select').onchange = (e) => patch({ artist_id: e.target.value ? +e.target.value : null });
      $('.due-input').onchange = (e) => patch({ due_date: e.target.value || null });
      container.querySelectorAll('[data-act]').forEach((b) => b.addEventListener('click', async (e) => {
        e.preventDefault();
        const act = b.dataset.act;
        if (act === 'add-proof') proofModal(r, +b.dataset.item, update);
        if (act === 'send') sendModal(r, update);
        if (act === 'review-ok') reviewModal(r, b.dataset.batch, 'approved', update);
        if (act === 'review-back') reviewModal(r, b.dataset.batch, 'returned', update);
        if (act === 'edit-client') clientModal(r, update);
        if (act === 'copy-filename') { await IM.copy(b.dataset.name); IM.toast(`Copied ${b.dataset.name}`); }
        if (act === 'edit-item') itemModal(r, r.items.find((i) => i.id === +b.dataset.item), update);
        if (act === 'add-item') itemModal(r, null, update);
        if (act === 'remove-item') {
          const it = r.items.find((i) => i.id === +b.dataset.item);
          IM.modal(`<h2>Remove ${esc(it.label)}?</h2><p class="muted">Any artwork attached to it will move to the job-wide artwork.</p>
            <div class="actions"><button data-close>Cancel</button><button class="btn-primary btn-danger x-go" style="background:var(--bad);border-color:var(--bad)">Remove product</button></div>`, {
            onMount(m, close) {
              m.querySelector('.x-go').onclick = async (e) => {
                try { update((await IM.busy(e.currentTarget, () => api(`/api/requests/${r.id}/items/${it.id}`, { method: 'DELETE' }))).request); close(); IM.toast('Product removed'); }
                catch (x) { IM.toast(x.message, true); }
              };
            },
          });
        }
        if (act === 'open-web') open(r.app_url);
        if (act === 'link') {
          try {
            const res = await IM.busy(b, () => api(`/api/requests/${r.id}/share-link`, { method: 'POST' }));
            const ok = await IM.copy(res.url);
            update(res.request);
            if (ok) IM.toast('Live link copied — paste it into the Sales Order');
            else IM.modal(`<h2>Live proof link</h2><input type="text" readonly value="${esc(res.url)}" onclick="this.select()"><div class="actions"><button data-close>Done</button></div>`);
          } catch (x) { IM.toast(x.message, true); }
        }
        if (act === 'comment') {
          const box = $('.comment-box');
          if (!box.value.trim()) return;
          try { update((await IM.busy(b, () => api(`/api/requests/${r.id}/comments`, { body: { body: box.value } }))).request); } catch (x) { IM.toast(x.message, true); }
        }
        if (act === 'add-art') { artItem = b.dataset.item || null; $('.art-input').click(); }
      }));
      $('.art-input').onchange = async (e) => {
        const fd = new FormData();
        [...e.target.files].forEach((f) => fd.append('artwork', f, f.name));
        if (artItem) fd.append('item_id', artItem);
        IM.toast('Uploading…');
        try { update((await api(`/api/requests/${r.id}/artwork`, { method: 'POST', body: fd })).request); IM.toast('Artwork added'); } catch (x) { IM.toast(x.message, true); }
      };
    }

    render();
    return { reload: async () => update((await api(`/api/requests/${r.id}`)).request) };
  };
})();

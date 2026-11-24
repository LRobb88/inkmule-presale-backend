// Art request form — used by /new and the Missive sidebar.
(function () {
  const { esc, h, api } = IM;

  function chipGroup(name, options, selected, multi) {
    return `<div class="chips" data-chips="${name}" data-multi="${multi ? 1 : 0}">${options
      .map((o) => `<label class="chip ${selected.includes(o) ? 'on' : ''}"><input type="${multi ? 'checkbox' : 'radio'}" value="${esc(o)}" ${selected.includes(o) ? 'checked' : ''}>${esc(o)}</label>`)
      .join('')}</div>`;
  }
  function wireChips(root, onChange) {
    root.querySelectorAll('[data-chips]').forEach((group) => {
      const multi = group.dataset.multi === '1';
      group.querySelectorAll('.chip').forEach((chip) => {
        chip.addEventListener('click', (e) => {
          e.preventDefault();
          const input = chip.querySelector('input');
          if (multi) input.checked = !input.checked;
          else group.querySelectorAll('input').forEach((i) => (i.checked = i === input ? !input.checked : false));
          group.querySelectorAll('.chip').forEach((c) => c.classList.toggle('on', c.querySelector('input').checked));
          onChange && onChange(group.dataset.chips);
        });
      });
    });
  }
  const chipValues = (root, name) => [...root.querySelectorAll(`[data-chips="${name}"] input:checked`)].map((i) => i.value);

  // A product card = one design (decoration, locations, ink, artwork, one proof) printed on
  // one or more garments. The first garment's fields live on the item itself; extra garments
  // that "run together" (same print, same proof) live in item.garments.
  const GARMENT_FIELDS = ['source', 'product_type', 'brand', 'style', 'title', 'color_name', 'color_hex', 'swatch_url', 'image_url',
    'back_image_url', 'vendor_url', 'ss_style_id', 'colors'];
  function blankGarment(ssEnabled) {
    return {
      source: ssEnabled ? 'ss' : 'manual', product_type: '', brand: '', style: '', title: '', color_name: '', color_hex: null,
      swatch_url: null, image_url: null, back_image_url: null, vendor_url: '', ss_style_id: null, colors: [], _colors: null, _colorQuery: '',
    };
  }
  function blankItem(ssEnabled) {
    return Object.assign(blankGarment(ssEnabled), {
      subname: '', decoration_type: '', decorator: '', sp_options: [], locations: [], print_colors: '', item_notes: '', garments: [], _otherLoc: '', _files: [],
    });
  }
  // Strip UI-only fields before sending to the server.
  function cleanGarment(g) {
    const out = {};
    GARMENT_FIELDS.forEach((f) => (out[f] = g[f]));
    return out;
  }
  function cleanItemForSave(it) {
    const { _colors, _colorQuery, _otherLoc, _files, versions, artwork, label, state, id, request_id, sort, ...rest } = it;
    rest.garments = (it.garments || []).map(cleanGarment);
    return rest;
  }

  // File name the artist uses for a product: JOBNAME-SUBNAME (or just JOBNAME).
  const cleanPart = (v) => String(v || '').replace(/[\\/:*?"<>|]/g, '').trim();
  IM.productFileName = (jobName, subname) => [cleanPart(jobName), cleanPart(subname)].filter(Boolean).join('-');

  // ---- One product card ----
  function ItemCard(item, idx, meta, { onRemove, canRemove, noTitle, jobName }) {
    // Job name comes from the form's Job name box, or is passed in when editing on the request page.
    const currentJob = () => (jobName != null ? jobName : ((document.querySelector('[name=job_name]') || {}).value || ''));
    const previewText = () => {
      const fn = IM.productFileName(currentJob(), item.subname);
      return fn ? `File name: <code>${esc(fn)}</code>` : 'Enter the job name to see the file name.';
    };
    const o = meta.options;
    const ssOn = meta.integrations.ss;
    const el = h(`<div class="item-card"></div>`);
    if (!Array.isArray(item.garments)) item.garments = [];
    const G = () => [item, ...item.garments];

    const swatchHtml = (c) => `<span class="swatch" style="${c.swatch ? `background-image:url('${esc(c.swatch)}')` : `background:${esc(c.hex ? (c.hex.startsWith('#') ? c.hex : '#' + c.hex) : '#ccc')}`}"></span>`;
    // color_name / image fields are derived from the selected colors (first color drives the images).
    function applyColors(g) {
      const first = g.colors[0];
      Object.assign(g, {
        color_name: g.colors.map((c) => c.name).join(', '),
        color_hex: first && first.hex ? (first.hex.startsWith('#') ? first.hex : `#${first.hex}`) : null,
        swatch_url: first ? first.swatch : null,
        image_url: first && first.front ? first.front : g.image_url,
        back_image_url: first ? first.back : null,
      });
    }
    function loadColors(g) {
      if (g.source !== 'ss' || !g.ss_style_id || g._colors) return;
      api(`/api/ss/styles/${g.ss_style_id}/colors`).then((r) => {
        g._colors = r.colors;
        if (!g.colors.length && g.color_name) {
          const names = g.color_name.split(/\s*,\s*/);
          g.colors = r.colors.filter((c) => names.includes(c.name)).map((c) => ({ name: c.name, hex: c.hex, swatch: c.swatch, front: c.front, back: c.back }));
        }
        render();
      }).catch(() => { g._colors = []; render(); });
    }
    function decoratorHtml() {
      const list = (o.decorators || {})[item.decoration_type];
      if (list) {
        const isOther = list.includes('Other') && item.decorator && !list.includes(item.decorator);
        const sel = isOther || item.decorator === 'Other' ? 'Other' : item.decorator;
        return `<div><span class="label req">Decorator</span>${chipGroup('decorator', list, [sel], false)}
          ${sel === 'Other' ? `<input type="text" class="f-deco-other" style="margin-top:6px" placeholder="Decorator name" value="${esc(isOther ? item.decorator : '')}">` : ''}</div>`;
      }
      if (item.decoration_type === 'Other') {
        return `<label class="field"><span class="req">Decorator</span><input type="text" class="f-deco-text" placeholder="Who's decorating this?" value="${esc(item.decorator || '')}"></label>`;
      }
      return '';
    }
    const garmentLabel = (g) => [g.brand, g.style].filter(Boolean).join(' ') || g.title || g.product_type || 'Garment';
    // Reorders: copy decoration (and optionally the garments) from a product on a previous job.
    function repeatPrevious() {
      const emailInput = document.querySelector('[name=client_email]');
      const email = emailInput ? emailInput.value.trim() : '';
      IM.modal(`<h2>Repeat a previous job</h2>
        <input type="search" class="rp-q" placeholder="Search job name, client, or style…">
        <div class="hint">${email ? `Showing ${esc(email)}'s jobs first.` : 'Most recent first.'} Copies decoration, decorator, print options, locations and ink colors — then pick the new garment colors.</div>
        <div class="rp-list stack" style="margin-top:10px;max-height:55vh;overflow:auto"><div class="empty"><span class="spin"></span></div></div>
        <div class="actions"><button data-close>Cancel</button></div>`, {
        onMount(m, close) {
          const list = m.querySelector('.rp-list');
          let t;
          const load = async () => {
            const qv = m.querySelector('.rp-q').value.trim();
            try {
              const { items } = await api(`/api/items/previous?q=${encodeURIComponent(qv)}&email=${encodeURIComponent(email)}`);
              list.innerHTML = items.length ? items.map((p, i) => `<div class="file" style="align-items:flex-start;flex-wrap:wrap">
                <div style="flex:1;min-width:220px">
                  <div><strong>${esc(p.job_name)}</strong> <span class="small muted">· ${esc(p.client_company || p.client_name || p.client_email || '')} · ${IM.fmtDate(p.request_created_at, { month: 'short', day: 'numeric', year: 'numeric' })}</span></div>
                  <div class="small">${esc(p.label)} — ${esc([p.color_name, ...(p.garments || []).map((g) => g.color_name)].filter(Boolean).join(' / '))}</div>
                  <div class="small muted">${esc(p.decoration_type)}${p.decorator ? ` · ${esc(p.decorator)}` : ''}${p.sp_options.length ? ` · ${esc(p.sp_options.join(', '))}` : ''} · ${esc(p.locations.join(', '))}${p.print_colors ? ` · Ink: ${esc(p.print_colors)}` : ''}</div>
                </div>
                <div class="row" style="gap:6px"><button type="button" class="btn-sm" data-rp="${i}" data-mode="deco">Decoration only</button>
                  <button type="button" class="btn-primary btn-sm" data-rp="${i}" data-mode="all">Same garments + decoration</button></div></div>`).join('')
                : '<div class="empty">No previous jobs found.</div>';
              list.querySelectorAll('[data-rp]').forEach((b) => (b.onclick = () => {
                const p = items[+b.dataset.rp];
                Object.assign(item, {
                  decoration_type: p.decoration_type, decorator: p.decorator || '', sp_options: [...p.sp_options],
                  locations: [...p.locations], print_colors: p.print_colors || '',
                  item_notes: [item.item_notes, `Repeat of ${p.job_name} (${p.label})`].filter(Boolean).join(' — '),
                  subname: item.subname || p.subname || '',
                });
                if (b.dataset.mode === 'all') {
                  const copyGarment = (src, dst) => {
                    const useSS = src.source === 'ss' && src.ss_style_id && ssOn;
                    Object.assign(dst, {
                      source: useSS ? 'ss' : 'manual', product_type: src.product_type, brand: src.brand, style: src.style, title: src.title,
                      ss_style_id: useSS ? src.ss_style_id : null, vendor_url: src.vendor_url, image_url: src.image_url,
                      colors: [], color_name: useSS ? '' : src.color_name, _colors: null, _colorQuery: '',
                    });
                    return dst;
                  };
                  copyGarment(p, item);
                  item.garments = (p.garments || []).map((g) => copyGarment(g, blankGarment(ssOn)));
                  G().forEach(loadColors);
                }
                close();
                render();
                IM.toast(b.dataset.mode === 'all' ? 'Copied — now pick the new colors' : 'Decoration copied');
              }));
            } catch (x) { list.innerHTML = `<div class="err">${esc(x.message)}</div>`; }
          };
          m.querySelector('.rp-q').addEventListener('input', () => { clearTimeout(t); t = setTimeout(load, 200); });
          m.style.maxWidth = '720px';
          load();
        },
      });
    }

    function garmentHtml(g, k) {
      const isSS = g.source === 'ss';
      return `<div class="garment ${k ? 'garment-extra' : ''}" data-g="${k}">
        ${k ? `<div class="row" style="margin-bottom:8px"><strong>+ Garment ${k + 1}</strong><span class="small muted">same print, same proof</span><div class="spacer"></div><button type="button" class="btn-ghost btn-sm" data-rmg="${k}">✕ Remove</button></div>` : ''}
        ${ssOn ? `<div class="tabs"><button type="button" data-src="ss" class="${isSS ? 'on' : ''}">S&amp;S Activewear</button><button type="button" data-src="manual" class="${!isSS ? 'on' : ''}">Other vendor</button></div>` : ''}
        <div class="stack">
          ${isSS ? `
            <div class="ss-pick" style="${g.ss_style_id ? 'display:none' : ''}">
              <label class="field" style="position:relative"><span class="req">Find the style</span>
                <input type="search" class="ss-q" placeholder="Style # or name — e.g. 3001, Comfort Colors 1717" autocomplete="off">
                <div class="ss-results hidden"></div>
              </label>
            </div>
            ${g.ss_style_id ? `
              <div class="picked">
                <img src="${esc(g.image_url || '')}" alt="">
                <div style="flex:1;min-width:0">
                  <div><strong>${esc(g.brand)} ${esc(g.style)}</strong></div>
                  <div class="small muted">${esc(g.title)}</div>
                  <div class="small" style="margin-top:3px">${g.colors.length ? `${g.colors.length > 1 ? `<strong>${g.colors.length} colors:</strong> ` : ''}${esc(g.color_name)}` : '<span class="err">Pick at least one color below</span>'}</div>
                </div>
                <button type="button" class="btn-sm change-style">Change</button>
              </div>
              <div>
                <span class="label req">Garment color(s) <span class="muted" style="font-weight:400">— pick one or more</span></span>
                ${g.colors.length ? `<div class="chips" style="margin-bottom:6px">${g.colors.map((c, i) => `<span class="chip on" style="cursor:default">${swatchHtml(c)}${esc(c.name)}<button type="button" class="btn-ghost btn-sm" data-uncolor="${i}" title="Remove" style="padding:0 2px">✕</button></span>`).join('')}</div>` : ''}
                ${g._colors ? `
                  <input type="search" class="color-q" placeholder="Search ${g._colors.length} colors — e.g. heather, navy, forest" value="${esc(g._colorQuery || '')}" autocomplete="off">
                  <div class="color-list">${g._colors.map((c, i) => `<button type="button" class="color-chip ${g.colors.some((x) => x.name === c.name) ? 'on' : ''}" data-ci="${i}" data-name="${esc(c.name.toLowerCase())}">${swatchHtml(c)}${esc(c.name)}</button>`).join('')}
                    <div class="small muted color-none hidden" style="padding:6px">No colors match.</div></div>` : '<span class="spin"></span>'}
              </div>
              <label class="field"><span>Vendor link</span><input type="url" class="f-vendor" value="${esc(g.vendor_url)}"><div class="hint">Filled in from S&amp;S — edit if it doesn't open the right page.</div></label>
            ` : ''}
          ` : `
            <div class="grid2">
              <label class="field"><span>Brand</span><input type="text" class="f-brand" value="${esc(g.brand)}" placeholder="e.g. Next Level"></label>
              <label class="field"><span class="req">Style / item</span><input type="text" class="f-style" value="${esc(g.style)}" placeholder="e.g. 6210 or 20oz Tumbler"></label>
            </div>
            <div class="grid2">
              <label class="field"><span class="req">Color</span><input type="text" class="f-color" value="${esc(g.color_name)}"></label>
              <label class="field"><span class="req">Vendor product link</span><input type="url" class="f-vendor" value="${esc(g.vendor_url)}" placeholder="https://"></label>
            </div>
          `}
          <label class="field"><span class="req">Product type</span>
            <select class="f-type"><option value="">Select…</option>${o.productTypes.map((t) => `<option ${t === g.product_type ? 'selected' : ''}>${esc(t)}</option>`).join('')}</select>
          </label>
        </div>
      </div>`;
    }

    let rendering = false;
    function render() {
      rendering = true;
      try { renderInner(); } finally { rendering = false; }
      wire();
    }
    function renderInner() {
      const knownLocs = item.locations.filter((l) => o.locations.includes(l));
      const otherLoc = item.locations.find((l) => !o.locations.includes(l)) || item._otherLoc || '';
      const multi = item.garments.length > 0;
      el.innerHTML = `
        ${canRemove ? '<button type="button" class="btn-ghost btn-sm remove" title="Remove product">✕ Remove</button>' : ''}
        ${noTitle ? '' : `<h2 style="margin-bottom:${multi ? 2 : 10}px">Product ${idx + 1}${multi ? ` <span class="badge teal" style="vertical-align:2px">${G().length} garments · one print</span>` : ''}</h2>`}
        ${multi ? `<div class="small muted" style="margin-bottom:10px">These garments run together: same print, one proof, one approval.</div>` : ''}
        <label class="field" style="margin-bottom:12px"><span>Job subname <span class="muted" style="font-weight:400">(optional)</span></span>
          <input type="text" class="f-subname" value="${esc(item.subname || '')}" placeholder="e.g. TEE, DESIGN1, HAT" maxlength="40" autocomplete="off">
          <div class="hint sub-preview">${previewText()}</div></label>
        <div class="stack">
          ${G().map((g, k) => garmentHtml(g, k)).join('')}
          <div><button type="button" class="btn-sm add-garment">+ Add additional garment (same print)</button></div>
          <div><span class="label req">Decoration</span>${chipGroup('decoration', o.decorationTypes, [item.decoration_type], false)}</div>
          ${decoratorHtml()}
          ${item.decoration_type === 'Screen Print' ? `<div><span class="label">Screen print options</span>${chipGroup('sp', o.spOptions, item.sp_options, true)}</div>` : ''}
          <div><div class="row" style="margin-bottom:4px"><span class="label req" style="margin:0">Print location(s)</span><div class="spacer"></div>
            <button type="button" class="btn-ghost btn-sm repeat-prev" title="Copy decoration from a previous job">↻ Repeat previous</button></div>${chipGroup('loc', o.locations, knownLocs.concat(otherLoc ? ['Other'] : []), true)}
            <input type="text" class="f-otherloc ${otherLoc || knownLocs.includes('Other') ? '' : 'hidden'}" style="margin-top:6px" placeholder="Describe the other location" value="${esc(otherLoc === 'Other' ? '' : otherLoc)}"></div>
          <div class="grid2">
            <label class="field"><span>Print colors</span><input type="text" class="f-colors" value="${esc(item.print_colors)}" placeholder="e.g. White, PMS 186"></label>
            <label class="field"><span>Notes for this product</span><input type="text" class="f-inotes" value="${esc(item.item_notes)}" placeholder="Size of print, special instructions…"></label>
          </div>
          <div>
            <span class="label">Artwork for this product</span>
            <div class="dropzone item-dz" style="padding:10px">Drop files or <u>browse</u> <span class="small">— or use "Artwork for the whole job" below</span></div>
            <input type="file" multiple class="hidden item-file" accept=".pdf,.ai,.eps,.svg,.png,.jpg,.jpeg,.psd,.tif,.tiff,.zip">
            <div class="files item-files" style="margin-top:6px">${item._files.map((f, i) => `<div class="file"><span class="name">${esc(f.name)}</span><span class="small muted">${(f.size / 1048576).toFixed(1)} MB</span><button type="button" class="btn-ghost btn-sm" data-rmf="${i}">✕</button></div>`).join('')}</div>
          </div>
        </div>`;
    }

    function sync() {
      if (rendering) return; // removing a focused input during re-render fires 'change' against a half-built DOM
      // Garment fields, scoped to each garment block.
      el.querySelectorAll('.garment').forEach((w) => {
        const g = G()[+w.dataset.g];
        if (!g) return;
        const v = (sel) => (w.querySelector(sel) ? w.querySelector(sel).value.trim() : undefined);
        if (v('.f-brand') !== undefined) g.brand = v('.f-brand');
        if (v('.f-style') !== undefined) g.style = v('.f-style');
        if (v('.f-color') !== undefined) g.color_name = v('.f-color');
        if (v('.f-vendor') !== undefined) g.vendor_url = v('.f-vendor');
        g.product_type = v('.f-type') || '';
      });
      // Shared design fields.
      const v = (sel) => (el.querySelector(sel) ? el.querySelector(sel).value.trim() : undefined);
      item.print_colors = v('.f-colors') || '';
      item.item_notes = v('.f-inotes') || '';
      if (v('.f-subname') !== undefined) item.subname = v('.f-subname');
      item.decoration_type = chipValues(el, 'decoration')[0] || '';
      item.sp_options = item.decoration_type === 'Screen Print' ? chipValues(el, 'sp') : [];
      const decoList = (o.decorators || {})[item.decoration_type];
      if (decoList) {
        const picked = chipValues(el, 'decorator')[0] || '';
        const other = v('.f-deco-other');
        item.decorator = picked === 'Other' ? (other || 'Other') : picked;
      } else if (item.decoration_type === 'Other') {
        item.decorator = v('.f-deco-text') || '';
      } else {
        item.decorator = '';
      }
      const locs = chipValues(el, 'loc');
      const other = v('.f-otherloc') || '';
      item._otherLoc = other;
      item.locations = locs.filter((l) => l !== 'Other').concat(locs.includes('Other') ? [other || 'Other'] : []);
    }

    function wireGarment(w) {
      const k = +w.dataset.g;
      const g = G()[k];
      w.querySelectorAll('.tabs [data-src]').forEach((b) => (b.onclick = () => {
        sync();
        if (g.source !== b.dataset.src) {
          const keepType = g.product_type;
          GARMENT_FIELDS.forEach((f) => (g[f] = blankGarment(true)[f]));
          Object.assign(g, { source: b.dataset.src, product_type: keepType, _colors: null, _colorQuery: '' });
        }
        render();
      }));
      const rmg = w.querySelector('[data-rmg]');
      if (rmg) rmg.onclick = () => { sync(); item.garments.splice(k - 1, 1); render(); };
      const change = w.querySelector('.change-style');
      if (change) change.onclick = () => {
        sync();
        Object.assign(g, { ss_style_id: null, brand: '', style: '', title: '', color_name: '', colors: [], image_url: null, back_image_url: null, swatch_url: null, vendor_url: '', _colors: null, _colorQuery: '' });
        render();
        const again = el.querySelector(`.garment[data-g="${k}"] .ss-q`);
        if (again) again.focus();
      };
      w.querySelectorAll('.color-chip').forEach((c) => (c.onclick = () => {
        sync();
        const col = g._colors[+c.dataset.ci];
        const at = g.colors.findIndex((x) => x.name === col.name);
        if (at > -1) g.colors.splice(at, 1);
        else g.colors.push({ name: col.name, hex: col.hex, swatch: col.swatch, front: col.front, back: col.back });
        applyColors(g);
        render();
      }));
      w.querySelectorAll('[data-uncolor]').forEach((b) => (b.onclick = () => { sync(); g.colors.splice(+b.dataset.uncolor, 1); applyColors(g); render(); }));
      const cq = w.querySelector('.color-q');
      if (cq) {
        const filter = () => {
          const words = cq.value.toLowerCase().split(/\s+/).filter(Boolean);
          let shown = 0;
          w.querySelectorAll('.color-chip').forEach((c) => {
            const ok = words.every((word) => c.dataset.name.includes(word));
            c.classList.toggle('hidden', !ok);
            if (ok) shown++;
          });
          w.querySelector('.color-none').classList.toggle('hidden', shown > 0);
        };
        cq.addEventListener('input', () => { g._colorQuery = cq.value; filter(); });
        cq.addEventListener('keydown', (e) => {
          if (e.key !== 'Enter') return;
          e.preventDefault();
          const firstMatch = [...w.querySelectorAll('.color-chip:not(.hidden)')][0];
          if (firstMatch) {
            firstMatch.click();
            const again = el.querySelector(`.garment[data-g="${k}"] .color-q`);
            if (again) { again.value = ''; g._colorQuery = ''; again.focus(); again.dispatchEvent(new Event('input')); }
          }
        });
        filter();
      }
      const q = w.querySelector('.ss-q');
      if (q) wireSearch(q, w.querySelector('.ss-results'), g);
    }

    function wire() {
      const rm = el.querySelector('.remove');
      if (rm) rm.onclick = () => onRemove();
      el.querySelectorAll('.garment').forEach(wireGarment);
      el.querySelector('.add-garment').onclick = () => {
        sync();
        item.garments.push(blankGarment(ssOn));
        render();
        const q = el.querySelector(`.garment[data-g="${item.garments.length}"] .ss-q, .garment[data-g="${item.garments.length}"] .f-style`);
        if (q) q.focus();
      };
      wireChips(el, (name) => {
        sync();
        if (name === 'decoration') { item.decorator = ''; render(); }
        if (name === 'decorator') render();
        if (name === 'loc') el.querySelector('.f-otherloc').classList.toggle('hidden', !chipValues(el, 'loc').includes('Other'));
      });
      el.querySelectorAll('input:not(.ss-q):not(.color-q), select').forEach((i) => i.addEventListener('change', sync));
      el.querySelector('.repeat-prev').onclick = () => { sync(); repeatPrevious(); };
      const sub = el.querySelector('.f-subname');
      const refresh = () => { item.subname = sub.value.trim(); el.querySelector('.sub-preview').innerHTML = previewText(); };
      sub.addEventListener('input', refresh);
      const job = jobName == null && document.querySelector('[name=job_name]');
      if (job && !job.dataset.subWired) {
        // One listener on the job name refreshes every product's preview.
        job.dataset.subWired = '1';
        job.addEventListener('input', () => document.querySelectorAll('.item-card .f-subname').forEach((i) => i.dispatchEvent(new Event('input'))));
      }
      const dz = el.querySelector('.item-dz'), fin = el.querySelector('.item-file');
      const addFiles = (list) => { sync(); item._files = item._files.concat([...list]); render(); };
      dz.onclick = () => fin.click();
      fin.onchange = () => addFiles(fin.files);
      dz.addEventListener('dragover', (e) => { e.preventDefault(); dz.classList.add('over'); });
      dz.addEventListener('dragleave', () => dz.classList.remove('over'));
      dz.addEventListener('drop', (e) => { e.preventDefault(); addFiles(e.dataTransfer.files); });
      el.querySelectorAll('[data-rmf]').forEach((b) => (b.onclick = () => { sync(); item._files.splice(+b.dataset.rmf, 1); render(); }));
    }

    function wireSearch(input, box, g) {
      let timer, results = [], active = -1;
      const show = () => {
        if (!results.length) { box.innerHTML = `<div class="opt muted">No matches — try the style number, or use "Other vendor".</div>`; }
        else box.innerHTML = results.map((r, i) => `<div class="opt ${i === active ? 'active' : ''}" data-i="${i}">${r.image ? `<img src="${esc(r.image)}" alt="">` : ''}<div><strong>${esc(r.brand)} ${esc(r.style)}</strong><div class="small muted">${esc(r.title)}</div></div></div>`).join('');
        box.classList.remove('hidden');
        box.querySelectorAll('[data-i]').forEach((opt) => opt.addEventListener('mousedown', (e) => { e.preventDefault(); pick(results[+opt.dataset.i], g); }));
      };
      input.addEventListener('input', () => {
        clearTimeout(timer);
        const val = input.value.trim();
        if (val.length < 2) { box.classList.add('hidden'); return; }
        timer = setTimeout(async () => {
          try { results = (await api(`/api/ss/search?q=${encodeURIComponent(val)}`)).results; active = -1; show(); } catch (e) { IM.toast(e.message, true); }
        }, 180);
      });
      input.addEventListener('keydown', (e) => {
        if (box.classList.contains('hidden') || !results.length) return;
        if (e.key === 'ArrowDown') { active = Math.min(active + 1, results.length - 1); show(); e.preventDefault(); }
        if (e.key === 'ArrowUp') { active = Math.max(active - 1, 0); show(); e.preventDefault(); }
        if (e.key === 'Enter') { e.preventDefault(); pick(results[Math.max(active, 0)], g); }
      });
      input.addEventListener('blur', () => setTimeout(() => box.classList.add('hidden'), 150));
    }

    async function pick(s, g) {
      sync();
      Object.assign(g, {
        ss_style_id: s.styleId, brand: s.brand, style: s.style, title: s.title, image_url: s.image, vendor_url: s.vendorUrl,
        color_name: '', colors: [], color_hex: null, swatch_url: null, back_image_url: null, _colors: null, _colorQuery: '',
        product_type: g.product_type || s.productType || guessType(s),
      });
      render();
      try {
        g._colors = (await api(`/api/ss/styles/${s.styleId}/colors`)).colors;
      } catch (e) {
        g._colors = [];
        IM.toast(`Couldn't load colors: ${e.message}`, true);
      }
      render();
    }
    function guessType(s) {
      const t = `${s.category || ''} ${s.title || ''}`.toLowerCase();
      const map = [[/hood/, 'Hoodie'], [/crew|sweatshirt|fleece/, 'Sweatshirt'], [/long sleeve/, 'Long Sleeve'], [/tank/, 'Tank Top'], [/polo/, 'Polo'], [/hat|cap|beanie|headwear/, 'Hat / Cap'], [/tote|bag/, 'Tote Bag'], [/t-shirt|tee/, 'T-Shirt']];
      const hit = map.find(([re]) => re.test(t));
      return hit ? hit[1] : '';
    }

    item.garments = item.garments.map((g) => Object.assign(blankGarment(ssOn), g, { _colors: null, _colorQuery: '' }));
    render();
    G().forEach(loadColors);
    return { el, sync, item };
  }

  function itemProblems(it, n) {
    const p = [];
    [it, ...(it.garments || [])].forEach((g, k) => {
      const gn = k ? `${n}, garment ${k + 1}` : n;
      if (g.source === 'ss' && !g.ss_style_id) p.push(`${gn}: pick the S&S style (or switch to Other vendor).`);
      else if (!g.style && !g.title) p.push(`${gn}: enter the style.`);
      if (!g.color_name) p.push(`${gn}: choose a color.`);
      if (!/^https?:\/\//.test(g.vendor_url)) p.push(`${gn}: add the vendor link.`);
      if (!g.product_type) p.push(`${gn}: choose a product type.`);
    });
    if (!it.decoration_type) p.push(`${n}: choose a decoration.`);
    else if ((IM._decorators[it.decoration_type] || it.decoration_type === 'Other') && (!it.decorator || it.decorator === 'Other')) p.push(`${n}: choose the decorator.`);
    if (!it.locations.length) p.push(`${n}: choose a print location.`);
    return p;
  }

  // Product editor used on the request page (edit an existing product, or add one).
  // Returns { el, collect() } — collect() gives { item, files } or throws with the problems.
  IM._decorators = {};
  IM.ItemEditor = async function ItemEditor(existing, { jobName = '' } = {}) {
    const meta = await IM.meta();
    IM._decorators = meta.options.decorators || {};
    const item = Object.assign(blankItem(meta.integrations.ss), existing ? JSON.parse(JSON.stringify(existing)) : {}, { _files: [], _colors: null, _colorQuery: '', _otherLoc: '' });
    if (existing && existing.source === 'ss' && !meta.integrations.ss) item.source = 'manual';
    const card = ItemCard(item, 0, meta, { canRemove: false, noTitle: true, jobName, onRemove() {} });
    return {
      el: card.el,
      collect() {
        card.sync();
        const problems = itemProblems(item, 'Product');
        if (problems.length) throw new Error(problems.join(' '));
        return { item: cleanItemForSave(item), files: item._files };
      },
    };
  };

  // ---- Full form ----
  async function proofForm(container, { prefill = {}, onCreated, compact } = {}) {
    const meta = await IM.meta();
    IM._decorators = meta.options.decorators || {};
    const ssOn = meta.integrations.ss;
    const items = [blankItem(ssOn)];
    let files = [];
    const artists = meta.users;

    container.innerHTML = '';
    const form = h(`<form class="stack" novalidate>
      <div class="card pad stack">
        <h2>Job</h2>
        <label class="field"><span class="req">Job name</span>
          <input type="text" name="job_name" value="${esc(prefill.job_name || '')}" placeholder="Use the job naming convention" autocomplete="off">
          <div class="hint job-hint">This becomes the Dropbox folder name.</div></label>
        <div class="grid2">
          <label class="field"><span class="req">Client email</span><input type="email" name="client_email" value="${esc(prefill.client_email || '')}"></label>
          <label class="field"><span>Client name</span><input type="text" name="client_name" value="${esc(prefill.client_name || '')}"></label>
        </div>
        <div class="grid2">
          <label class="field"><span>Company</span><input type="text" name="client_company" value="${esc(prefill.client_company || '')}"></label>
          <label class="field"><span>CC on proof emails</span><input type="text" name="cc_emails" value="${esc(prefill.cc_emails || '')}" placeholder="other@client.com, …"></label>
        </div>
        <div class="grid2">
          <label class="field"><span>Proof needed by</span><input type="date" name="due_date" value="${esc(prefill.due_date || '')}"></label>
          <label class="field"><span>Artist (optional)</span><select name="artist_id"><option value="">Unassigned — art team picks it up</option>${artists.map((u) => `<option value="${u.id}">${esc(u.name || u.email)}</option>`).join('')}</select></label>
        </div>
      </div>
      <div class="card pad"><div class="row" style="margin-bottom:12px"><h2>Products</h2></div><div class="items"></div>
        <button type="button" class="add-item" style="margin-top:12px">+ Add another product</button></div>
      <div class="card pad stack">
        <h2>Artwork for the whole job &amp; notes</h2>
        <div class="dropzone">Drop artwork files here or <u>browse</u><div class="small">PDF, AI, EPS, SVG, PNG, JPG, PSD, TIF</div></div>
        <input type="file" multiple class="hidden" accept=".pdf,.ai,.eps,.svg,.png,.jpg,.jpeg,.psd,.tif,.tiff,.zip">
        <div class="files file-list"></div>
        <label class="field"><span>Notes for the art team</span><textarea name="notes" placeholder="Anything the artist should know — references, what the client said, rush, etc.">${esc(prefill.notes || '')}</textarea></label>
      </div>
      <div class="form-err err" style="font-size:13px"></div>
      <div class="row"><div class="spacer"></div><button type="submit" class="btn-primary">Submit request</button></div>
    </form>`);
    container.appendChild(form);

    const itemsBox = form.querySelector('.items');
    let cards = [];
    const renderItems = () => {
      cards.forEach((c) => c.sync());
      itemsBox.innerHTML = '';
      cards = items.map((it, i) => ItemCard(it, i, meta, { canRemove: items.length > 1, onRemove: () => { cards.forEach((c) => c.sync()); items.splice(i, 1); cards = []; renderItems(); } }));
      cards.forEach((c) => itemsBox.appendChild(c.el));
    };
    renderItems();
    form.querySelector('.add-item').onclick = () => {
      cards.forEach((c) => c.sync());
      const last = items[items.length - 1];
      const next = blankItem(ssOn);
      // Most multi-product jobs share decoration & locations; copy them as a head start.
      Object.assign(next, { decoration_type: last.decoration_type, decorator: last.decorator, sp_options: [...last.sp_options], locations: [...last.locations], print_colors: last.print_colors });
      items.push(next);
      cards = [];
      renderItems();
    };

    // Job name availability
    const jobInput = form.querySelector('[name=job_name]');
    const jobHint = form.querySelector('.job-hint');
    let jobTimer;
    const checkJob = () => {
      clearTimeout(jobTimer);
      const val = jobInput.value.trim();
      if (!val) { jobHint.className = 'hint job-hint'; jobHint.textContent = 'This becomes the Dropbox folder name.'; return; }
      jobTimer = setTimeout(async () => {
        try {
          const r = await api(`/api/requests/check-name?name=${encodeURIComponent(val)}`);
          jobHint.className = r.available ? 'hint job-hint' : 'err job-hint';
          jobHint.innerHTML = r.available ? `Dropbox folder: <code>${esc(r.folder)}</code>` : `A request with this job name already exists — <a href="/requests/${r.existingId}" target="_blank">open it</a>.`;
        } catch {}
      }, 300);
    };
    jobInput.addEventListener('input', checkJob);
    if (jobInput.value) checkJob();

    // Files
    const dz = form.querySelector('.dropzone');
    const fileInput = form.querySelector('input[type=file]');
    const fileList = form.querySelector('.file-list');
    const renderFiles = () => {
      fileList.innerHTML = files.map((f, i) => `<div class="file"><span class="name">${esc(f.name)}</span><span class="small muted">${(f.size / 1048576).toFixed(1)} MB</span><button type="button" class="btn-ghost btn-sm" data-rm="${i}">✕</button></div>`).join('');
      fileList.querySelectorAll('[data-rm]').forEach((b) => (b.onclick = () => { files.splice(+b.dataset.rm, 1); renderFiles(); }));
    };
    dz.onclick = () => fileInput.click();
    fileInput.onchange = () => { files = files.concat([...fileInput.files]); fileInput.value = ''; renderFiles(); };
    dz.addEventListener('dragover', (e) => { e.preventDefault(); dz.classList.add('over'); });
    dz.addEventListener('dragleave', () => dz.classList.remove('over'));
    dz.addEventListener('drop', (e) => { e.preventDefault(); dz.classList.remove('over'); files = files.concat([...e.dataTransfer.files]); renderFiles(); });

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      cards.forEach((c) => c.sync());
      const errBox = form.querySelector('.form-err');
      errBox.textContent = '';
      const fd = new FormData(form);
      const data = {
        job_name: fd.get('job_name').trim(), client_email: fd.get('client_email').trim(), client_name: fd.get('client_name').trim(),
        client_company: fd.get('client_company').trim(), cc_emails: fd.get('cc_emails').trim(), due_date: fd.get('due_date') || null,
        artist_id: fd.get('artist_id') ? +fd.get('artist_id') : null, notes: fd.get('notes').trim(),
        missive_conversation_id: prefill.missive_conversation_id || null, missive_subject: prefill.missive_subject || null,
        items: items.map(cleanItemForSave),
      };
      // Quick client-side checks (server validates too).
      const problems = [];
      if (!data.job_name) problems.push('Job name is required.');
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.client_email)) problems.push('Client email is required.');
      data.items.forEach((it, i) => problems.push(...itemProblems(it, `Product ${i + 1}`)));
      if (problems.length) { errBox.innerHTML = problems.map(esc).join('<br>'); errBox.scrollIntoView({ block: 'center', behavior: 'smooth' }); return; }

      const body = new FormData();
      body.append('data', JSON.stringify(data));
      files.forEach((f) => body.append('artwork', f, f.name));
      items.forEach((it, i) => it._files.forEach((f) => body.append(`artwork_item_${i}`, f, f.name)));
      const btn = form.querySelector('[type=submit]');
      try {
        const res = await IM.busy(btn, () => api('/api/requests', { method: 'POST', body }));
        IM.toast('Request submitted');
        onCreated && onCreated(res.request);
      } catch (err) {
        errBox.textContent = err.message;
      }
    });
    return form;
  }

  // ---- Ad-hoc design / mockup request (lighter: no product specs) ----
  async function designForm(container, { prefill = {}, onCreated } = {}) {
    const meta = await IM.meta();
    let files = [];
    container.innerHTML = '';
    const form = h(`<form class="stack" novalidate>
      <div class="card pad stack">
        <label class="field"><span class="req">Request name</span>
          <input type="text" name="job_name" value="${esc(prefill.job_name || '')}" placeholder="e.g. Acme Brewing – tee mockups for pitch" autocomplete="off">
          <div class="hint job-hint">This becomes the Dropbox folder name.</div></label>
        <div><span class="label req">Type of work</span>${chipGroup('work', meta.options.designTypes, [], false)}
          <input type="text" class="f-work-other hidden" style="margin-top:6px" placeholder="What kind of work?"></div>
        <label class="field"><span class="req">What do you need?</span><textarea name="notes" rows="5" placeholder="Describe the ask: what it's for, ideas, colors, text, how many options, anything the client said…">${esc(prefill.notes || '')}</textarea></label>
        <label class="field"><span>Products / placement (optional)</span><input type="text" name="product_context" placeholder="e.g. Comfort Colors 1717 in Ivory, full front — or 'any tee'"></label>
        <div class="grid2">
          <label class="field"><span>Needed by</span><input type="date" name="due_date" value="${esc(prefill.due_date || '')}"></label>
          <label class="field"><span>Artist (optional)</span><select name="artist_id"><option value="">Unassigned — art team picks it up</option>${meta.users.map((u) => `<option value="${u.id}">${esc(u.name || u.email)}</option>`).join('')}</select></label>
        </div>
        <details ${prefill.client_email ? 'open' : ''}><summary class="small" style="cursor:pointer;font-weight:600">Client (optional — only needed to send it to them)</summary>
          <div class="grid2" style="margin-top:10px">
            <label class="field"><span>Client email</span><input type="email" name="client_email" value="${esc(prefill.client_email || '')}"></label>
            <label class="field"><span>Client name</span><input type="text" name="client_name" value="${esc(prefill.client_name || '')}"></label>
          </div>
          <label class="field" style="margin-top:10px"><span>Company</span><input type="text" name="client_company" value="${esc(prefill.client_company || '')}"></label>
        </details>
        <div>
          <span class="label">Reference files</span>
          <div class="dropzone">Drop logos, inspiration, sketches… or <u>browse</u></div>
          <input type="file" multiple class="hidden">
          <div class="files file-list" style="margin-top:6px"></div>
        </div>
      </div>
      <div class="form-err err" style="font-size:13px"></div>
      <div class="row"><div class="spacer"></div><button type="submit" class="btn-primary">Submit request</button></div>
    </form>`);
    container.appendChild(form);
    wireChips(form, () => form.querySelector('.f-work-other').classList.toggle('hidden', chipValues(form, 'work')[0] !== 'Other'));
    const dz = form.querySelector('.dropzone'), fin = form.querySelector('input[type=file]'), list = form.querySelector('.file-list');
    const renderFiles = () => {
      list.innerHTML = files.map((f, i) => `<div class="file"><span class="name">${esc(f.name)}</span><button type="button" class="btn-ghost btn-sm" data-rm="${i}">✕</button></div>`).join('');
      list.querySelectorAll('[data-rm]').forEach((b) => (b.onclick = () => { files.splice(+b.dataset.rm, 1); renderFiles(); }));
    };
    dz.onclick = () => fin.click();
    fin.onchange = () => { files = files.concat([...fin.files]); fin.value = ''; renderFiles(); };
    dz.addEventListener('dragover', (e) => { e.preventDefault(); dz.classList.add('over'); });
    dz.addEventListener('dragleave', () => dz.classList.remove('over'));
    dz.addEventListener('drop', (e) => { e.preventDefault(); dz.classList.remove('over'); files = files.concat([...e.dataTransfer.files]); renderFiles(); });
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(form);
      let work = chipValues(form, 'work')[0] || '';
      if (work === 'Other') work = form.querySelector('.f-work-other').value.trim();
      const data = {
        kind: 'design', job_name: fd.get('job_name').trim(), work_type: work, notes: fd.get('notes').trim(),
        product_context: fd.get('product_context').trim(), due_date: fd.get('due_date') || null,
        artist_id: fd.get('artist_id') ? +fd.get('artist_id') : null,
        client_email: fd.get('client_email').trim(), client_name: fd.get('client_name').trim(), client_company: fd.get('client_company').trim(),
        missive_conversation_id: prefill.missive_conversation_id || null, missive_subject: prefill.missive_subject || null,
      };
      const errBox = form.querySelector('.form-err');
      const problems = [];
      if (!data.job_name) problems.push('Give the request a name.');
      if (!data.work_type) problems.push('Choose the type of work.');
      if (!data.notes) problems.push('Describe what you need.');
      if (problems.length) { errBox.innerHTML = problems.map(esc).join('<br>'); return; }
      const body = new FormData();
      body.append('data', JSON.stringify(data));
      files.forEach((f) => body.append('artwork', f, f.name));
      try {
        const res = await IM.busy(form.querySelector('[type=submit]'), () => api('/api/requests', { method: 'POST', body }));
        IM.toast('Request submitted');
        onCreated && onCreated(res.request);
      } catch (x) { errBox.textContent = x.message; }
    });
  }

  // Entry point: a switch between the full proof request and the lighter design request.
  IM.RequestForm = async function RequestForm(container, opts = {}) {
    container.innerHTML = '';
    const bar = h(`<div class="seg" style="margin-bottom:12px"><button type="button" data-k="proof" class="on">Proof request</button><button type="button" data-k="design">Design / mockup</button></div>`);
    const hint = h(`<div class="small muted" style="margin:-4px 0 12px"></div>`);
    const body = h('<div></div>');
    container.append(bar, hint, body);
    const show = async (k) => {
      bar.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.k === k));
      hint.textContent = k === 'design'
        ? 'For mockups, graphic design and art cleanup — just describe what you need.'
        : 'For proofs of an order: full product, decoration and placement details.';
      if (k === 'design') await designForm(body, opts); else await proofForm(body, opts);
    };
    bar.querySelectorAll('button').forEach((b) => (b.onclick = () => show(b.dataset.k)));
    await show(opts.kind === 'design' ? 'design' : 'proof');
  };
})();

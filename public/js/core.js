// Shared helpers for the web app and Missive sidebar.
(function () {
  const IM = (window.IM = window.IM || {});

  IM.token = null; // set by Missive sidebar (Bearer auth); web app uses the session cookie
  IM.onUnauthorized = () => { location.href = `/login?next=${encodeURIComponent(location.pathname + location.search)}`; };

  IM.api = async function api(path, opts = {}) {
    const headers = Object.assign({}, opts.headers || {});
    if (IM.token) headers.Authorization = `Bearer ${IM.token}`;
    let body = opts.body;
    if (body && !(body instanceof FormData) && typeof body !== 'string') {
      headers['Content-Type'] = 'application/json';
      body = JSON.stringify(body);
    }
    const res = await fetch(path, { method: opts.method || (body ? 'POST' : 'GET'), headers, body, credentials: 'same-origin' });
    if (res.status === 401) { IM.onUnauthorized(); throw new Error('Please sign in'); }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
    return data;
  };

  let metaPromise = null;
  IM.colColors = {};
  IM.archiveCols = [];
  IM.meta = (fresh) => {
    if (!metaPromise || fresh) {
      metaPromise = IM.api('/api/meta').then((m) => {
        IM.colColors = Object.fromEntries(m.statuses.map((c) => [c.key, c.color]));
        IM.archiveCols = m.statuses.filter((c) => c.archive).map((c) => c.key);
        return m;
      });
    }
    return metaPromise;
  };

  IM.esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

  // Escape text and turn any URLs in it into clickable links (opens in a new tab).
  IM.linkify = (text) => IM.esc(text).replace(/\b(https?:\/\/|www\.)[^\s<]+/gi, (m) => {
    let url = m.split(/&quot;|&#39;|&lt;|&gt;/)[0];
    let tail = m.slice(url.length);
    // Leave trailing punctuation (and an unmatched closing paren) outside the link.
    for (;;) {
      const last = url.slice(-1);
      const unbalanced = last === ')' && (url.match(/\(/g) || []).length < (url.match(/\)/g) || []).length;
      if (!/[.,;:!?\]]/.test(last) && !unbalanced) break;
      tail = last + tail;
      url = url.slice(0, -1);
    }
    const href = /^www\./i.test(url) ? `https://${url}` : url;
    return `<a href="${href}" target="_blank" rel="noopener noreferrer" style="word-break:break-all">${url}</a>${tail}`;
  });

  IM.h = function h(html) {
    const t = document.createElement('template');
    t.innerHTML = html.trim();
    return t.content.firstElementChild;
  };

  IM.fmtDate = (d, opts) => {
    if (!d) return '';
    const date = typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d) ? new Date(d + 'T12:00:00') : new Date(d);
    return date.toLocaleDateString(undefined, opts || { month: 'short', day: 'numeric' });
  };
  IM.dateOnly = (d) => (d ? String(d).slice(0, 10) : '');
  IM.ago = (d) => {
    if (!d) return '';
    const s = (Date.now() - new Date(d).getTime()) / 1000;
    if (s < 60) return 'just now';
    if (s < 3600) return `${Math.floor(s / 60)}m ago`;
    if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
    if (s < 7 * 86400) return `${Math.floor(s / 86400)}d ago`;
    return IM.fmtDate(d);
  };
  IM.dueBadge = (due, status) => {
    if (!due || IM.archiveCols.includes(status)) return due ? `<span class="badge">Due ${IM.fmtDate(due)}</span>` : '';
    const days = Math.round((new Date(due + 'T12:00:00') - new Date(new Date().toDateString() + ' 12:00')) / 864e5);
    const cls = days < 0 ? 'bad' : days <= 2 ? 'warn' : '';
    const label = days < 0 ? `Overdue ${IM.fmtDate(due)}` : days === 0 ? 'Due today' : days === 1 ? 'Due tomorrow' : `Due ${IM.fmtDate(due)}`;
    return `<span class="badge ${cls}">${label}</span>`;
  };
  IM.initials = (name) => String(name || '?').split(/[\s@.]+/).filter(Boolean).slice(0, 2).map((p) => p[0].toUpperCase()).join('');
  IM.avatar = (name, picture, title) =>
    `<span class="avatar" title="${IM.esc(title || name || '')}">${picture ? `<img src="${IM.esc(picture)}" alt="" referrerpolicy="no-referrer">` : IM.esc(IM.initials(name))}</span>`;

  // Column badge with the column's color dot (colors come from Settings → Board columns).
  IM.statusBadge = (key, label) => {
    const c = IM.colColors[key];
    return `<span class="badge">${c ? `<span style="width:7px;height:7px;border-radius:50%;background:${IM.esc(c)};display:inline-block"></span>` : ''}${IM.esc(label || key)}</span>`;
  };

  // Badges summarizing where each product's proof stands (board cards, list, sidebar).
  IM.proofHint = (r) => {
    const s = r.summary;
    if (!s || !s.total || s.none === s.total) return '';
    const b = [];
    if (s.review) b.push(`<span class="badge orange">${s.review} in sales review</span>`);
    if (s.changes) b.push(`<span class="badge bad">${s.changes} changes requested</span>`);
    if (s.returned) b.push(`<span class="badge bad">${s.returned} sent back by sales</span>`);
    if (s.ready) b.push(`<span class="badge teal">${s.ready} ready to send</span>`);
    if (s.awaiting) b.push(`<span class="badge ${s.viewed ? 'ok' : ''}">${s.awaiting} with client${s.viewed ? ' · viewed' : ''}</span>`);
    if (s.total > 1 && s.approved) b.push(`<span class="badge ok">${s.approved}/${s.total} approved</span>`);
    if (s.total > 1 && s.none && s.none < s.total) b.push(`<span class="badge">${s.none} not proofed</span>`);
    return b.join(' ');
  };
  IM.ITEM_STATES = {
    none: ['No proof yet', ''], review: ['In sales review', 'orange'], returned: ['Sent back by sales', 'bad'],
    ready: ['Ready to send', 'teal'], awaiting: ['With client', ''], approved: ['Approved', 'ok'], changes: ['Changes requested', 'bad'],
  };
  IM.itemStateBadge = (state) => { const [l, c] = IM.ITEM_STATES[state] || [state, '']; return `<span class="badge ${c}">${IM.esc(l)}</span>`; };

  IM.toast = (msg, bad) => {
    const el = IM.h(`<div class="toast ${bad ? 'bad' : ''}">${IM.esc(msg)}</div>`);
    document.body.appendChild(el);
    setTimeout(() => el.remove(), bad ? 5000 : 2600);
  };

  IM.modal = (html, { onMount } = {}) => {
    const bg = IM.h(`<div class="modal-bg"><div class="modal">${html}</div></div>`);
    const close = () => bg.remove();
    bg.addEventListener('mousedown', (e) => { if (e.target === bg) close(); });
    bg.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', close));
    document.body.appendChild(bg);
    if (onMount) onMount(bg.querySelector('.modal'), close);
    const first = bg.querySelector('textarea, input');
    if (first) first.focus();
    return close;
  };

  IM.copy = async (text) => {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      const ta = IM.h(`<textarea style="position:fixed;opacity:0"></textarea>`);
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      let ok = false;
      try { ok = document.execCommand('copy'); } catch {}
      ta.remove();
      return ok;
    }
  };

  IM.busy = async (btn, fn) => {
    const prev = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = `<span class="spin"></span> ${prev}`;
    try { return await fn(); } finally { btn.disabled = false; btn.innerHTML = prev; }
  };

  // Web app top bar.
  IM.topbar = async (active) => {
    const { user } = await IM.api('/api/me');
    if (!user) return IM.onUnauthorized();
    IM.user = user;
    const bar = IM.h(`<header class="topbar">
      <a class="brand" href="/board">inkmule<span>Proofs</span></a>
      <nav class="row">
        <a href="/board" class="${active === 'board' ? 'active' : ''}">Board</a>
        <a href="/new" class="${active === 'new' ? 'active' : ''}">New request</a>
        <a href="/settings" class="${active === 'settings' ? 'active' : ''}">Settings</a>
      </nav>
      <div class="spacer"></div>
      <div class="me">${IM.avatar(user.name, user.picture)} ${IM.esc(user.name || user.email)}
        <button class="btn-ghost btn-sm" style="color:#d6ecec" id="logout">Sign out</button></div>
    </header>`);
    bar.querySelector('#logout').onclick = async () => { await IM.api('/auth/logout', { method: 'POST' }); location.href = '/login'; };
    document.body.prepend(bar);
    return user;
  };
})();

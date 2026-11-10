/* Sky High — shared lead tracker. No framework, no build step. */
(() => {
  'use strict';

  /* ------------------------------------------------------------------ */
  /* Constants                                                           */
  /* ------------------------------------------------------------------ */
  const STATUSES = [
    { key: 'new', label: 'New', c: '#64748b' },
    { key: 'no_answer', label: 'No Answer', c: '#d97706' },
    { key: 'callback', label: 'Call Back', c: '#7c3aed' },
    { key: 'wa_dropped', label: 'WhatsApp Dropped', c: '#0d9488' },
    { key: 'positive', label: 'Positive', c: '#16a34a' },
    { key: 'meeting_set', label: 'Meeting Booked', c: '#2563eb' },
    { key: 'meeting_done', label: 'Meeting Done', c: '#047857' },
    { key: 'rejected', label: 'Rejected', c: '#dc2626' },
    { key: 'wrong_number', label: 'Wrong Number', c: '#78716c' },
  ];
  const ST = Object.fromEntries(STATUSES.map((s) => [s.key, s]));
  const DEFAULT_TEMPLATE =
    'Hi {first}, hope you are well! I just tried calling you regarding {agency}. Would love to connect for a quick chat — when suits you?';
  const ZOOMS = [0.85, 0.92, 1, 1.08, 1.16, 1.25, 1.35, 1.45];
  const PAGE = 80;
  const POLL_MS = 7000;

  const I = {
    phone: '<svg viewBox="0 0 24 24"><path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1.9.4 1.8.7 2.7a2 2 0 0 1-.5 2.1L8 9.8a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.7.7a2 2 0 0 1 1.7 2Z"/></svg>',
    chat: '<svg viewBox="0 0 24 24"><path d="M3 21l1.7-5A8.5 8.5 0 1 1 8 19.3L3 21Z"/><path d="M9 10h.01M12 10h.01M15 10h.01" stroke-width="3"/></svg>',
    file: '<svg viewBox="0 0 24 24"><path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><path d="M14 3v6h6M8 13h8M8 17h5"/></svg>',
  };

  /* ------------------------------------------------------------------ */
  /* Local storage helpers                                               */
  /* ------------------------------------------------------------------ */
  const LS = {
    get(k, d) { try { const v = localStorage.getItem('sh_' + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
    set(k, v) { try { localStorage.setItem('sh_' + k, JSON.stringify(v)); } catch { /* storage full or blocked */ } },
    del(k) { try { localStorage.removeItem('sh_' + k); } catch {} },
  };

  /* ------------------------------------------------------------------ */
  /* State                                                               */
  /* ------------------------------------------------------------------ */
  const S = {
    token: LS.get('token', ''),
    me: LS.get('me', ''),
    cc: LS.get('cc', '971'),
    waMode: LS.get('waMode', 'web'),
    zoom: LS.get('zoom', 2),
    contacts: new Map((LS.get('contacts', []) || []).map((c) => [c.id, c])),
    settings: LS.get('settings', {}),
    since: LS.get('since', 0),
    outbox: LS.get('outbox', []),
    view: 'leads',
    filter: LS.get('filter', 'all'),
    sort: LS.get('sort', 'rank'),
    q: '',
    shown: PAGE,
    online: true,
    afterCall: null,
    afterWa: null,
  };

  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
  const uid = () => (crypto.randomUUID ? crypto.randomUUID() : 'id-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 10));

  let saveTimer;
  function persist() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      LS.set('contacts', [...S.contacts.values()]);
      LS.set('since', S.since);
      LS.set('settings', S.settings);
    }, 200);
  }
  const saveOutbox = () => LS.set('outbox', S.outbox);

  /* ------------------------------------------------------------------ */
  /* Phone helpers                                                       */
  /* ------------------------------------------------------------------ */
  function normPhone(raw, cc = S.cc) {
    let s = String(raw == null ? '' : raw).trim();
    if (!s) return '';
    if (/e\+?\d+$/i.test(s) && !isNaN(Number(s))) s = BigInt(Math.round(Number(s))).toString(); // 9.715E+11 from Excel
    const plus = s.startsWith('+');
    let d = s.replace(/\D/g, '');
    if (!d) return '';
    if (plus) return '+' + d;
    if (d.startsWith('00')) return '+' + d.slice(2);
    if (cc && d.startsWith(cc) && d.length > cc.length + 6) return '+' + d;
    if (d.startsWith('0')) return '+' + cc + d.replace(/^0+/, '');
    if (d.length <= 9 && cc) return '+' + cc + d; // e.g. 501234567
    return '+' + d;
  }
  function fmtPhone(p) {
    const d = String(p || '').replace(/\D/g, '');
    if (d.startsWith('971') && d.length === 12) return `+971 ${d.slice(3, 5)} ${d.slice(5, 8)} ${d.slice(8)}`;
    if (d.startsWith('971') && d.length === 11) return `+971 ${d.slice(3, 4)} ${d.slice(4, 7)} ${d.slice(7)}`;
    if (d.startsWith('1') && d.length === 11) return `+1 ${d.slice(1, 4)} ${d.slice(4, 7)} ${d.slice(7)}`;
    if (d.startsWith('44') && d.length === 12) return `+44 ${d.slice(2, 6)} ${d.slice(6)}`;
    return p || '';
  }
  const telHref = (p) => 'tel:' + String(p || '').replace(/[^\d+]/g, '');
  function waHref(c) {
    const num = String(c.phone || '').replace(/\D/g, '');
    const text = fillTemplate(S.settings.waTemplate || DEFAULT_TEMPLATE, c);
    return S.waMode === 'app'
      ? `whatsapp://send?phone=${num}&text=${encodeURIComponent(text)}`
      : `https://wa.me/${num}?text=${encodeURIComponent(text)}`;
  }
  function fillTemplate(t, c) {
    const owner = (c.owner || '').trim();
    const first = owner.split(/\s+/)[0] || 'there';
    return t
      .replace(/\{owner\}/gi, owner || 'there')
      .replace(/\{first\}/gi, first)
      .replace(/\{agency\}/gi, (c.agency || '').trim() || 'your agency')
      .replace(/\{me\}/gi, S.me || '');
  }
  const phoneIndex = () => {
    const m = new Map();
    for (const c of S.contacts.values()) m.set(c.phone, c);
    return m;
  };

  /* ------------------------------------------------------------------ */
  /* Time helpers                                                        */
  /* ------------------------------------------------------------------ */
  function ago(ms) {
    if (!ms) return '';
    const s = Math.round((Date.now() - ms) / 1000);
    if (s < 45) return 'just now';
    const m = Math.round(s / 60);
    if (m < 60) return m + 'm ago';
    const h = Math.round(m / 60);
    if (h < 24) return h + 'h ago';
    const d = Math.round(h / 24);
    if (d < 7) return d + 'd ago';
    return new Date(ms).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
  }
  const stamp = (ms) => new Date(ms).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });

  /* ------------------------------------------------------------------ */
  /* Network: API, outbox, sync                                          */
  /* ------------------------------------------------------------------ */
  async function api(method, url, body) {
    const r = await fetch(url, {
      method,
      headers: { 'content-type': 'application/json', 'x-auth': S.token || '', 'x-user': encodeURIComponent(S.me || '').slice(0, 40) },
      body: body ? JSON.stringify(body) : undefined,
      cache: 'no-store',
    });
    const j = await r.json().catch(() => ({}));
    if (r.status === 401 && !url.endsWith('/login')) { signOut(true); throw Object.assign(new Error('auth'), { status: 401 }); }
    if (!r.ok) throw Object.assign(new Error(j.error || 'Request failed'), { status: r.status, body: j });
    return j;
  }

  function enqueue(op) {
    S.outbox.push(op);
    saveOutbox();
    setSync();
    flush();
  }

  let flushing = false;
  async function flush() {
    if (flushing) return;
    flushing = true;
    try {
      while (S.outbox.length) {
        const op = S.outbox[0];
        try {
          const res = await api(op.method, op.url, op.body);
          S.outbox.shift();
          saveOutbox();
          handleOk(op, res);
          S.online = true;
        } catch (e) {
          if (!e.status) { S.online = false; break; } // offline: keep it and retry later
          if (e.status === 401) break;
          S.outbox.shift(); // rejected by the server: drop it and tell the user
          saveOutbox();
          handleFail(op, e);
        }
      }
    } finally {
      flushing = false;
      setSync();
    }
  }

  function handleOk(op, res) {
    if (op.kind === 'import' && res.skipped?.length) {
      res.skipped.forEach((s) => S.contacts.delete(s.id));
      persist();
      render();
    }
    if (res.contact) { S.contacts.set(res.contact.id, res.contact); persist(); }
  }

  function handleFail(op, e) {
    if (op.kind === 'add') {
      S.contacts.delete(op.body.contact.id);
      toast(e.status === 409 ? 'Not added — that number is already saved' : e.message);
    } else if (op.kind === 'import') {
      (op.body.contacts || []).forEach((c) => S.contacts.delete(c.id));
      toast('Import failed: ' + e.message);
    } else {
      toast(e.message || 'Could not save');
    }
    persist();
    pull(true);
  }

  let pulling = false;
  async function pull(full) {
    if (!S.token || pulling) return;
    pulling = true;
    try {
      await flush();
      if (S.outbox.length && !S.online) return;
      const since = full ? 0 : Math.max(0, S.since - 3000);
      const res = await api('GET', '/api/sync?since=' + since);
      const pending = new Set(S.outbox.map((o) => o.id).filter(Boolean));
      if (full) {
        for (const id of [...S.contacts.keys()]) if (!pending.has(id)) S.contacts.delete(id);
      }
      let changed = full;
      for (const c of res.contacts) {
        if (pending.has(c.id)) continue;
        const cur = S.contacts.get(c.id);
        if (c.deleted) { if (cur) { S.contacts.delete(c.id); changed = true; } continue; }
        if (!cur || cur.updatedAt !== c.updatedAt) { S.contacts.set(c.id, c); changed = true; }
      }
      if (!S.outbox.some((o) => o.kind === 'settings') && JSON.stringify(res.settings) !== JSON.stringify(S.settings)) {
        S.settings = res.settings || {};
        changed = true;
      }
      S.since = res.now;
      S.online = true;
      persist();
      if (changed) render();
    } catch (e) {
      if (!e.status) S.online = false;
    } finally {
      pulling = false;
      setSync();
    }
  }

  function setSync() {
    const dot = $('#syncDot');
    if (!dot) return;
    dot.classList.toggle('offline', !S.online);
    dot.classList.toggle('pending', S.online && S.outbox.length > 0);
    dot.title = !S.online ? `Offline — ${S.outbox.length} change(s) waiting` : S.outbox.length ? 'Saving…' : 'All changes synced';
  }

  /* ------------------------------------------------------------------ */
  /* Mutations (optimistic)                                              */
  /* ------------------------------------------------------------------ */
  function addContact(data) {
    const now = Date.now();
    const c = {
      id: uid(), agency: data.agency || '', rank: data.rank || null, owner: data.owner || '',
      phone: data.phone, status: data.status || 'new', notes: data.notes || '',
      history: [{ s: data.status || 'new', at: now, by: S.me }], addedBy: S.me, updatedBy: S.me,
      callCount: 0, lastCalledAt: null, createdAt: now, updatedAt: now,
    };
    S.contacts.set(c.id, c);
    persist();
    enqueue({ kind: 'add', id: c.id, method: 'POST', url: '/api/contacts', body: { contact: c } });
    return c;
  }

  function patchContact(id, fields, { silent } = {}) {
    const cur = S.contacts.get(id);
    if (!cur) return;
    const now = Date.now();
    const next = { ...cur, ...fields, updatedAt: now, updatedBy: S.me };
    delete next.call;
    if (fields.status && fields.status !== cur.status) next.history = [...(cur.history || []), { s: fields.status, at: now, by: S.me }];
    if (fields.call) { next.callCount = (cur.callCount || 0) + 1; next.lastCalledAt = now; }
    S.contacts.set(id, next);
    persist();
    enqueue({ kind: 'patch', id, method: 'PATCH', url: '/api/contacts/' + encodeURIComponent(id), body: fields });
    if (!silent) render();
    return cur;
  }

  function deleteContact(id) {
    const cur = S.contacts.get(id);
    S.contacts.delete(id);
    persist();
    enqueue({ kind: 'delete', id, method: 'DELETE', url: '/api/contacts/' + encodeURIComponent(id) });
    render();
    return cur;
  }

  function setStatus(id, status) {
    const prev = S.contacts.get(id)?.status;
    if (!prev || prev === status) return;
    patchContact(id, { status });
    const c = S.contacts.get(id);
    toast(`${c.agency || c.owner || 'Lead'} → ${ST[status].label}`, 'Undo', () => patchContact(id, { status: prev }));
  }

  /* ------------------------------------------------------------------ */
  /* Leads view                                                          */
  /* ------------------------------------------------------------------ */
  function filtered() {
    const q = S.q.trim().toLowerCase();
    const qd = q.replace(/\D/g, '');
    let arr = [...S.contacts.values()];
    if (S.filter !== 'all') arr = arr.filter((c) => c.status === S.filter);
    if (q) {
      arr = arr.filter((c) =>
        (c.agency || '').toLowerCase().includes(q) ||
        (c.owner || '').toLowerCase().includes(q) ||
        (c.notes || '').toLowerCase().includes(q) ||
        (qd.length >= 3 && String(c.phone).replace(/\D/g, '').includes(qd.replace(/^0+/, ''))));
    }
    const byRank = (a, b) => (a.rank ?? 1e9) - (b.rank ?? 1e9) || (a.agency || '').localeCompare(b.agency || '');
    const sorters = {
      rank: byRank,
      new: (a, b) => b.createdAt - a.createdAt,
      updated: (a, b) => b.updatedAt - a.updatedAt,
      az: (a, b) => (a.agency || a.owner || '').localeCompare(b.agency || b.owner || ''),
    };
    return arr.sort(sorters[S.sort] || byRank);
  }

  function hl(text) {
    const t = esc(text);
    const q = S.q.trim();
    if (q.length < 2) return t;
    const re = new RegExp('(' + q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ')', 'ig');
    return t.replace(re, '<mark>$1</mark>');
  }

  function renderChips() {
    const counts = { all: S.contacts.size };
    for (const c of S.contacts.values()) counts[c.status] = (counts[c.status] || 0) + 1;
    const chips = [{ key: 'all', label: 'All', c: '#ffffff' }, ...STATUSES];
    $('#chips').innerHTML = chips
      .filter((s) => s.key === 'all' || counts[s.key] || S.filter === s.key)
      .map((s) => `<button class="chip ${S.filter === s.key ? 'on' : ''}" data-filter="${s.key}" role="tab" aria-selected="${S.filter === s.key}" style="--c:${s.c}">
        ${s.key === 'all' ? '' : '<span class="dot"></span>'}${esc(s.label)} <i>${counts[s.key] || 0}</i></button>`)
      .join('');
  }

  function cardHtml(c) {
    const st = ST[c.status] || ST.new;
    const meta = [];
    if (c.addedBy) meta.push(`Added by ${esc(c.addedBy)} · ${ago(c.createdAt)}`);
    else meta.push(`Added ${ago(c.createdAt)}`);
    if (c.callCount) meta.push(`📞 ${c.callCount}× · last ${ago(c.lastCalledAt)}`);
    if (c.updatedBy && c.updatedAt - c.createdAt > 2000) meta.push(`Updated by ${esc(c.updatedBy)} ${ago(c.updatedAt)}`);
    return `<article class="card" data-id="${esc(c.id)}">
      <div class="card-main" data-act="open">
        <div class="rank ${c.rank && c.rank <= 3 ? 'top' : ''}">${c.rank ? '#' + c.rank : '—'}</div>
        <div class="who">
          <h3>${hl(c.agency || c.owner || 'Unnamed')}</h3>
          <p>${c.agency && c.owner ? hl(c.owner) + ' · ' : ''}<span class="ph">${hl(fmtPhone(c.phone))}</span></p>
        </div>
        <button class="pill" data-act="status" style="--c:${st.c}" aria-label="Change status">${esc(st.label)}</button>
      </div>
      ${c.notes ? `<div class="note">${hl(c.notes)}</div>` : ''}
      <div class="actions">
        <a class="act call" href="${esc(telHref(c.phone))}" data-act="call">${I.phone}Call</a>
        <a class="act wa" href="${esc(waHref(c))}" data-act="wa" target="_blank" rel="noopener">${I.chat}WhatsApp</a>
      </div>
      <div class="meta">${meta.map((m) => `<span>${m}</span>`).join('')}</div>
    </article>`;
  }

  function renderList() {
    const arr = filtered();
    const list = $('#list');
    if (!arr.length) {
      const none = !S.contacts.size;
      list.innerHTML = `<div class="empty">
        <div style="font-size:2.5rem">${none ? '☁️' : '🔍'}</div>
        <h2>${none ? 'No leads yet' : 'Nothing matches'}</h2>
        <p>${none ? 'Add a contact or bulk-import a CSV / Excel sheet to get started.' : 'Try another search or status filter.'}</p>
        ${none ? '<button class="btn primary" data-nav="add">Add first contact</button> <button class="btn" data-nav="import">Import a sheet</button>' : '<button class="btn" data-clear>Clear filters</button>'}
      </div>`;
      $('#more').textContent = '';
      return;
    }
    list.innerHTML = arr.slice(0, S.shown).map(cardHtml).join('');
    $('#more').textContent = arr.length > S.shown ? `Showing ${S.shown} of ${arr.length} — scroll for more` : `${arr.length} lead${arr.length === 1 ? '' : 's'}`;
  }

  function render() {
    if (S.view === 'leads') { renderChips(); renderList(); }
    if (S.view === 'settings') renderSettingsStats();
  }

  /* ------------------------------------------------------------------ */
  /* Sheets                                                              */
  /* ------------------------------------------------------------------ */
  let sheetOnClose = null;
  function openSheet(html, onClose) {
    $('#sheetBody').innerHTML = html;
    $('#scrim').hidden = false;
    $('#sheet').hidden = false;
    $('#sheet').scrollTop = 0;
    sheetOnClose = onClose || null;
  }
  function closeSheet() {
    $('#scrim').hidden = true;
    $('#sheet').hidden = true;
    $('#sheetBody').innerHTML = '';
    const f = sheetOnClose;
    sheetOnClose = null;
    if (f) f();
  }

  function formHtml(c = {}) {
    return `<div class="form">
      <div class="field"><label for="f-agency">Agency name</label>
        <input id="f-agency" name="agency" value="${esc(c.agency)}" placeholder="e.g. Allsopp &amp; Allsopp" autocomplete="off" autocapitalize="words"></div>
      <div class="row2">
        <div class="field"><label for="f-owner">Owner name</label>
          <input id="f-owner" name="owner" value="${esc(c.owner)}" placeholder="e.g. Ahmed Khan" autocomplete="off" autocapitalize="words"></div>
        <div class="field"><label for="f-rank">Rank</label>
          <input id="f-rank" name="rank" value="${esc(c.rank || '')}" placeholder="#" inputmode="numeric" autocomplete="off"></div>
      </div>
      <div class="field"><label for="f-phone">Phone number</label>
        <input id="f-phone" name="phone" type="tel" value="${esc(c.phone || '')}" placeholder="050 123 4567 or +971…" autocomplete="off" inputmode="tel" required>
        <div id="dupWarn"></div></div>
      <div class="field"><label for="f-notes">Notes</label>
        <textarea id="f-notes" name="notes" placeholder="Anything useful for the call…">${esc(c.notes)}</textarea></div>
    </div>`;
  }

  function readForm() {
    const v = (n) => $(`#sheetBody [name="${n}"]`)?.value.trim() || '';
    const r = parseInt(v('rank').replace(/\D/g, ''), 10);
    return { agency: v('agency'), owner: v('owner'), rank: r > 0 ? r : null, phone: normPhone(v('phone')), rawPhone: v('phone'), notes: v('notes') };
  }

  function wireDupCheck(selfId) {
    const input = $('#f-phone');
    const check = () => {
      const p = normPhone(input.value);
      const hit = p && p.replace(/\D/g, '').length >= 8 ? phoneIndex().get(p) : null;
      $('#dupWarn').innerHTML = hit && hit.id !== selfId
        ? `<div class="warn">Already saved as <b>${esc(hit.agency || hit.owner || hit.phone)}</b> (${esc(ST[hit.status]?.label)}). <button type="button" data-open="${esc(hit.id)}">Open it</button></div>`
        : p && input.value.trim() ? `<div class="hint">Saved as ${esc(fmtPhone(p))}</div>` : '';
      return hit && hit.id !== selfId ? hit : null;
    };
    input.addEventListener('input', check);
    check();
    return check;
  }

  function openAdd() {
    openSheet(`<h2>New contact</h2><p class="sub">Saved instantly and synced to everyone.</p>
      ${formHtml()}
      <div class="field" style="margin-top:.8rem"><label>Status</label>${statusGridHtml('new', 'pick')}</div>
      <div class="btn-row" style="margin-top:1rem">
        <button class="btn" data-save="again">Save &amp; add another</button>
        <button class="btn primary" data-save="close">Save</button>
      </div>`);
    let picked = 'new';
    const dup = wireDupCheck(null);
    $('#sheetBody').addEventListener('click', (e) => {
      const p = e.target.closest('[data-pick]');
      if (p) { picked = p.dataset.pick; $$('#sheetBody .status-opt').forEach((b) => b.classList.toggle('on', b === p)); return; }
      const s = e.target.closest('[data-save]');
      if (!s) return;
      const f = readForm();
      if (!f.phone || f.phone.replace(/\D/g, '').length < 6) { toast('Enter a valid phone number'); $('#f-phone').focus(); return; }
      if (dup()) { toast('That number is already saved'); return; }
      addContact({ ...f, status: picked });
      if (S.view !== 'leads') go('leads');
      render();
      if (s.dataset.save === 'again') {
        toast(`Saved ${f.agency || f.owner || fmtPhone(f.phone)}`);
        ['owner', 'phone', 'notes'].forEach((n) => ($(`#sheetBody [name="${n}"]`).value = ''));
        const rk = $('#f-rank'); if (rk.value && /^\d+$/.test(rk.value)) rk.value = String(+rk.value + 1);
        $('#dupWarn').innerHTML = '';
        $('#f-owner').focus();
      } else {
        closeSheet();
        toast(`Saved ${f.agency || f.owner || fmtPhone(f.phone)}`);
      }
    });
    setTimeout(() => $('#f-agency')?.focus(), 250);
  }

  function statusGridHtml(current, attr = 'set') {
    return `<div class="status-grid">${STATUSES.map((s) =>
      `<button type="button" class="status-opt ${s.key === current ? 'on' : ''}" data-${attr}="${s.key}" style="--c:${s.c}">${esc(s.label)}</button>`).join('')}</div>`;
  }

  function openStatus(id, title) {
    const c = S.contacts.get(id);
    if (!c) return;
    openSheet(`<h2>${esc(title || 'Update status')}</h2>
      <p class="sub">${esc(c.agency || '')}${c.agency && c.owner ? ' · ' : ''}${esc(c.owner || '')} · ${esc(fmtPhone(c.phone))}</p>
      ${statusGridHtml(c.status)}
      <div class="field" style="margin-top:1rem"><label for="q-note">Add a note (optional)</label>
        <textarea id="q-note" placeholder="e.g. Call back Thursday 4pm, interested in waterfront…" style="min-height:4rem"></textarea></div>
      <button class="btn primary block" data-done style="margin-top:.8rem">Done</button>`);
    const commit = () => {
      const note = $('#q-note')?.value.trim();
      if (note) {
        const cur = S.contacts.get(id);
        const line = `${new Date().toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}: ${note}`;
        patchContact(id, { notes: cur.notes ? cur.notes + '\n' + line : line });
      }
    };
    $('#sheetBody').addEventListener('click', (e) => {
      const b = e.target.closest('[data-set]');
      if (b) { commit(); closeSheet(); setStatus(id, b.dataset.set); return; }
      if (e.target.closest('[data-done]')) { commit(); closeSheet(); }
    });
  }

  function openDetail(id) {
    const c = S.contacts.get(id);
    if (!c) return;
    const hist = [...(c.history || [])].reverse();
    openSheet(`<h2>${esc(c.agency || c.owner || 'Contact')}</h2>
      <p class="sub">${c.rank ? 'Rank #' + c.rank + ' · ' : ''}${esc(fmtPhone(c.phone))}</p>
      <div class="detail-actions">
        <a class="act call" href="${esc(telHref(c.phone))}" data-act="call" data-id="${esc(c.id)}">${I.phone}Call</a>
        <a class="act wa" href="${esc(waHref(c))}" data-act="wa" data-id="${esc(c.id)}" target="_blank" rel="noopener">${I.chat}WhatsApp</a>
      </div>
      <div class="section-t">Status</div>
      ${statusGridHtml(c.status)}
      <div class="section-t">Details</div>
      ${formHtml(c)}
      <div class="btn-row" style="margin-top:1rem">
        <button class="btn danger" data-del>Delete</button>
        <button class="btn primary" data-savedetail>Save changes</button>
      </div>
      <div class="section-t">History</div>
      <ul class="timeline">
        ${c.callCount ? `<li>📞 Called ${c.callCount}× · last ${esc(stamp(c.lastCalledAt))}</li>` : ''}
        ${hist.map((h) => `<li><span class="pill" style="--c:${ST[h.s]?.c || '#64748b'}">${esc(ST[h.s]?.label || h.s)}</span>${esc(stamp(h.at))}${h.by ? ' · ' + esc(h.by) : ''}</li>`).join('')}
      </ul>`);
    const dup = wireDupCheck(c.id);
    $('#sheetBody').addEventListener('click', (e) => {
      const b = e.target.closest('[data-set]');
      if (b) {
        setStatus(id, b.dataset.set);
        $$('#sheetBody [data-set]').forEach((x) => x.classList.toggle('on', x === b));
        return;
      }
      if (e.target.closest('[data-savedetail]')) {
        const f = readForm();
        if (!f.phone || f.phone.replace(/\D/g, '').length < 6) { toast('Enter a valid phone number'); return; }
        if (dup()) { toast('That number belongs to another contact'); return; }
        const cur = S.contacts.get(id);
        const changes = {};
        ['agency', 'owner', 'rank', 'phone', 'notes'].forEach((k) => { if ((cur[k] ?? null) !== (f[k] ?? null) && !(cur[k] == null && f[k] === '')) changes[k] = f[k]; });
        if (Object.keys(changes).length) patchContact(id, changes);
        closeSheet();
        toast('Saved');
        return;
      }
      if (e.target.closest('[data-del]')) {
        const btn = e.target.closest('[data-del]');
        if (!btn.dataset.armed) { btn.dataset.armed = '1'; btn.textContent = 'Tap again to delete'; return; }
        const gone = deleteContact(id);
        closeSheet();
        toast('Contact deleted', 'Undo', () => {
          const { id: _old, ...rest } = gone;
          addContact({ ...rest });
        });
      }
    });
  }

  /* ------------------------------------------------------------------ */
  /* Call / WhatsApp follow-ups                                           */
  /* ------------------------------------------------------------------ */
  function onCall(id) {
    patchContact(id, { call: true }, { silent: true });
    S.afterCall = { id, hidden: false, at: Date.now() };
  }
  function onWa(id) {
    S.afterWa = { id, hidden: false, at: Date.now() };
  }
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      if (S.afterCall) S.afterCall.hidden = true;
      if (S.afterWa) S.afterWa.hidden = true;
      return;
    }
    pull();
    // Back from the phone app: ask how the call went.
    if (S.afterCall?.hidden && Date.now() - S.afterCall.at < 3 * 3600e3) {
      const { id } = S.afterCall;
      S.afterCall = null;
      const c = S.contacts.get(id);
      if (c) setTimeout(() => openStatus(id, `How did the call with ${c.owner || c.agency || 'them'} go?`), 350);
      render();
      return;
    }
    if (S.afterWa?.hidden) {
      const { id } = S.afterWa;
      S.afterWa = null;
      const c = S.contacts.get(id);
      if (c && c.status !== 'wa_dropped') {
        setTimeout(() => toast(`Message sent to ${c.owner || c.agency || 'them'}?`, 'Mark WhatsApp Dropped', () => setStatus(id, 'wa_dropped'), 9000), 300);
      }
    }
  });

  /* ------------------------------------------------------------------ */
  /* Import view                                                         */
  /* ------------------------------------------------------------------ */
  const FIELD_DEFS = [
    { key: 'agency', label: 'Agency', syn: ['agency name', 'agency', 'company', 'company name', 'brokerage', 'firm', 'office', 'business'] },
    { key: 'rank', label: 'Rank', syn: ['rank', 'ranking', 'position', 'agency rank', 'no', '#', 'sr', 'sr no', 's no'] },
    { key: 'owner', label: 'Owner', syn: ['owner', 'owner name', 'name', 'contact name', 'contact', 'ceo', 'broker', 'agent', 'agent name', 'manager', 'person', 'full name'] },
    { key: 'phone', label: 'Phone', syn: ['phone', 'phone number', 'mobile', 'mobile number', 'number', 'contact number', 'whatsapp', 'tel', 'telephone', 'cell', 'mob'] },
    { key: 'notes', label: 'Notes', syn: ['notes', 'note', 'comments', 'comment', 'remarks', 'remark', 'details'] },
    { key: 'status', label: 'Status', syn: ['status', 'stage', 'lead status'] },
  ];
  let IMP = null; // { rows, headers, hasHeader, map, sheets, wb }

  function renderImport() {
    const v = $('#view-import');
    v.innerHTML = `
      <div class="panel">
        <h2>Bulk upload contacts</h2>
        <p>Upload an Excel (.xlsx / .xls) or CSV file. Columns are matched automatically — Agency, Rank, Owner, Phone (and optional Notes / Status). Duplicate numbers are skipped.</p>
        <label class="drop" id="drop">
          ${I.file}
          <strong>Choose a file</strong>
          <span>.xlsx, .xls, .csv — or drag it here</span>
          <input id="file" type="file" accept=".csv,.tsv,.txt,.xlsx,.xls,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel" hidden>
        </label>
        <p class="hint" style="margin:.6rem 0 0">Need a starting point? <a href="#" id="tpl">Download a template CSV</a>.</p>
      </div>
      <div class="panel">
        <h2>…or paste rows</h2>
        <p>Copy cells straight from Excel / Google Sheets and paste here (include the header row if you have one).</p>
        <textarea id="paste" class="input" rows="4" placeholder="Agency, Rank, Owner, Phone"></textarea>
        <button class="btn" id="pasteGo" style="margin-top:.6rem">Read pasted rows</button>
      </div>
      <div id="impStage"></div>`;
    const drop = $('#drop');
    $('#file').addEventListener('change', (e) => e.target.files[0] && readFile(e.target.files[0]));
    ['dragenter', 'dragover'].forEach((t) => drop.addEventListener(t, (e) => { e.preventDefault(); drop.classList.add('over'); }));
    ['dragleave', 'drop'].forEach((t) => drop.addEventListener(t, (e) => { e.preventDefault(); drop.classList.remove('over'); }));
    drop.addEventListener('drop', (e) => e.dataTransfer.files[0] && readFile(e.dataTransfer.files[0]));
    $('#tpl').addEventListener('click', (e) => {
      e.preventDefault();
      download('sky-high-template.csv', 'Agency,Rank,Owner,Phone,Notes\nExample Realty,1,Ahmed Khan,0501234567,Met at Cityscape\n');
    });
    $('#pasteGo').addEventListener('click', () => {
      const t = $('#paste').value;
      if (!t.trim()) return toast('Paste some rows first');
      startMapping(parseDelimited(t), 'Pasted rows');
    });
    if (IMP) renderMapping();
  }

  function parseDelimited(text) {
    text = text.replace(/^﻿/, '');
    const first = text.split(/\r?\n/)[0] || '';
    const delim = ['\t', ',', ';', '|'].map((d) => [d, first.split(d).length]).sort((a, b) => b[1] - a[1])[0][0];
    const rows = [];
    let row = [], cell = '', q = false;
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (q) {
        if (ch === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; }
        else cell += ch;
      } else if (ch === '"' && cell === '') q = true;
      else if (ch === delim) { row.push(cell); cell = ''; }
      else if (ch === '\n' || ch === '\r') {
        if (ch === '\r' && text[i + 1] === '\n') i++;
        row.push(cell); rows.push(row); row = []; cell = '';
      } else cell += ch;
    }
    if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
    return rows.filter((r) => r.some((x) => String(x).trim() !== ''));
  }

  let xlsxLoading;
  function loadXlsx() {
    if (window.XLSX) return Promise.resolve(window.XLSX);
    xlsxLoading = xlsxLoading || new Promise((res, rej) => {
      const s = document.createElement('script');
      s.src = 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js';
      s.onload = () => res(window.XLSX);
      s.onerror = () => { xlsxLoading = null; rej(new Error('Could not load the Excel reader — check your connection, or save the sheet as CSV.')); };
      document.head.appendChild(s);
    });
    return xlsxLoading;
  }

  async function readFile(file) {
    try {
      if (/\.(xlsx|xls|xlsm|ods)$/i.test(file.name)) {
        toast('Reading spreadsheet…');
        const X = await loadXlsx();
        const wb = X.read(await file.arrayBuffer(), { type: 'array' });
        const sheetRows = (name) => X.utils.sheet_to_json(wb.Sheets[name], { header: 1, raw: true, defval: '' })
          .map((r) => r.map((v) => (typeof v === 'number' ? (Number.isInteger(v) ? BigInt(v).toString() : String(v)) : String(v))))
          .filter((r) => r.some((x) => x.trim() !== ''));
        startMapping(sheetRows(wb.SheetNames[0]), file.name, { names: wb.SheetNames, get: sheetRows, current: wb.SheetNames[0] });
      } else {
        startMapping(parseDelimited(await file.text()), file.name);
      }
    } catch (e) {
      toast(e.message || 'Could not read that file');
    }
  }

  function guessMap(headers) {
    const norm = (h) => String(h).toLowerCase().replace(/[_\-.:]/g, ' ').replace(/\s+/g, ' ').trim();
    const H = headers.map(norm);
    const map = {};
    const used = new Set();
    for (const pass of ['exact', 'contains']) {
      for (const f of FIELD_DEFS) {
        if (map[f.key] != null) continue;
        for (const s of f.syn) {
          const i = H.findIndex((h, idx) => !used.has(idx) && (pass === 'exact' ? h === s : s.length > 2 && h.includes(s)));
          if (i >= 0) { map[f.key] = i; used.add(i); break; }
        }
      }
    }
    return map;
  }

  function startMapping(rows, name, sheets) {
    if (!rows.length) return toast('That file looks empty');
    const width = Math.max(...rows.map((r) => r.length));
    rows = rows.map((r) => Array.from({ length: width }, (_, i) => String(r[i] ?? '').trim()));
    const headerMap = guessMap(rows[0]);
    const hasHeader = Object.keys(headerMap).length > 0 && !/^\+?[\d\s()-]{7,}$/.test(rows[0][headerMap.phone] || '');
    let map = headerMap;
    if (!hasHeader) {
      // No header row: find the column that looks most like phone numbers.
      map = {};
      const score = (i) => rows.slice(0, 30).filter((r) => /^\+?[\d\s()-]{7,}$/.test(r[i])).length;
      let best = -1, bestScore = 0;
      for (let i = 0; i < width; i++) { const s = score(i); if (s > bestScore) { best = i; bestScore = s; } }
      if (best >= 0) map.phone = best;
    }
    IMP = { rows, name, hasHeader, map, sheets, width };
    renderMapping();
    $('#impStage')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  const colName = (i) => (IMP.hasHeader && IMP.rows[0][i] ? IMP.rows[0][i] : 'Column ' + String.fromCharCode(65 + (i % 26)));

  function prepared() {
    const data = IMP.hasHeader ? IMP.rows.slice(1) : IMP.rows;
    const existing = phoneIndex();
    const seen = new Set();
    const statusByLabel = Object.fromEntries(STATUSES.flatMap((s) => [[s.label.toLowerCase(), s.key], [s.key, s.key]]));
    return data.map((r) => {
      const g = (k) => (IMP.map[k] != null ? r[IMP.map[k]] : '');
      const phone = normPhone(g('phone'));
      const rk = parseInt(String(g('rank')).replace(/\D/g, ''), 10);
      const item = {
        agency: g('agency'), owner: g('owner'), rank: rk > 0 ? rk : null, phone, notes: g('notes'),
        status: statusByLabel[String(g('status')).toLowerCase().trim()] || 'new', raw: g('phone'),
      };
      if (!phone || phone.replace(/\D/g, '').length < 7) item.skip = 'No valid phone';
      else if (existing.has(phone)) item.skip = 'Already saved';
      else if (seen.has(phone)) item.skip = 'Duplicate in file';
      else seen.add(phone);
      return item;
    });
  }

  function renderMapping() {
    const stage = $('#impStage');
    if (!stage || !IMP) return;
    const items = prepared();
    const ok = items.filter((x) => !x.skip);
    const dup = items.filter((x) => x.skip === 'Already saved' || x.skip === 'Duplicate in file').length;
    const bad = items.filter((x) => x.skip === 'No valid phone').length;
    const opts = (sel) => `<option value="">— none —</option>` +
      Array.from({ length: IMP.width }, (_, i) => `<option value="${i}" ${sel === i ? 'selected' : ''}>${esc(colName(i))}</option>`).join('');
    stage.innerHTML = `<div class="panel">
      <h2>${esc(IMP.name)}</h2>
      ${IMP.sheets && IMP.sheets.names.length > 1 ? `<div class="field" style="margin-bottom:.7rem"><label>Sheet</label><select id="sheetSel" class="input">${IMP.sheets.names.map((n) => `<option ${n === IMP.sheets.current ? 'selected' : ''}>${esc(n)}</option>`).join('')}</select></div>` : ''}
      <p>Check the columns are matched correctly:</p>
      <div class="map-grid">
        ${FIELD_DEFS.map((f) => `<label for="map-${f.key}">${f.label}${f.key === 'phone' ? ' *' : ''}</label><select id="map-${f.key}" class="input" data-map="${f.key}">${opts(IMP.map[f.key])}</select>`).join('')}
        <label for="hasHeader">Header row</label>
        <label style="font-weight:500;display:flex;gap:.5rem;align-items:center"><input type="checkbox" id="hasHeader" ${IMP.hasHeader ? 'checked' : ''}> First row is column names</label>
      </div>
      <div class="stats">
        <div class="stat good"><b>${ok.length}</b><span>Ready to import</span></div>
        <div class="stat"><b>${dup}</b><span>Duplicates skipped</span></div>
        <div class="stat bad"><b>${bad}</b><span>Missing phone</span></div>
      </div>
      <div class="table-wrap"><table>
        <thead><tr><th>Rank</th><th>Agency</th><th>Owner</th><th>Phone</th><th></th></tr></thead>
        <tbody>${items.slice(0, 8).map((x) => `<tr>
          <td>${x.rank ?? ''}</td><td>${esc(x.agency)}</td><td>${esc(x.owner)}</td>
          <td class="${x.skip ? 'skip' : ''}">${esc(x.phone ? fmtPhone(x.phone) : x.raw)}</td><td>${x.skip ? esc(x.skip) : '✓'}</td></tr>`).join('')}
        </tbody></table></div>
      ${items.length > 8 ? `<p class="hint">Previewing 8 of ${items.length} rows.</p>` : ''}
      <div class="progress" id="impProg" hidden><i></i></div>
      <div class="btn-row">
        <button class="btn" id="impCancel">Cancel</button>
        <button class="btn primary" id="impGo" ${ok.length && IMP.map.phone != null ? '' : 'disabled'}>Import ${ok.length} contact${ok.length === 1 ? '' : 's'}</button>
      </div>
    </div>`;
    $$('#impStage [data-map]').forEach((s) => s.addEventListener('change', () => {
      const k = s.dataset.map;
      IMP.map[k] = s.value === '' ? null : Number(s.value);
      renderMapping();
    }));
    $('#hasHeader').addEventListener('change', (e) => { IMP.hasHeader = e.target.checked; renderMapping(); });
    $('#sheetSel')?.addEventListener('change', (e) => {
      const name = e.target.value;
      const sheets = { ...IMP.sheets, current: name };
      startMapping(sheets.get(name), IMP.name, sheets);
    });
    $('#impCancel').addEventListener('click', () => { IMP = null; renderImport(); });
    $('#impGo').addEventListener('click', () => runImport(ok));
  }

  async function runImport(items) {
    const btn = $('#impGo');
    btn.disabled = true;
    const prog = $('#impProg');
    prog.hidden = false;
    const now = Date.now();
    const all = items.map((x, i) => ({
      id: uid(), agency: x.agency, rank: x.rank, owner: x.owner, phone: x.phone, status: x.status, notes: x.notes,
      history: [{ s: x.status, at: now, by: S.me }], addedBy: S.me, updatedBy: S.me, callCount: 0, lastCalledAt: null,
      createdAt: now + i, updatedAt: now,
    }));
    let inserted = 0, skipped = 0;
    const CHUNK = 400;
    for (let i = 0; i < all.length; i += CHUNK) {
      const chunk = all.slice(i, i + CHUNK);
      chunk.forEach((c) => S.contacts.set(c.id, c));
      try {
        const r = await api('POST', '/api/contacts', { contacts: chunk });
        inserted += r.inserted.length;
        skipped += r.skipped.length;
        r.skipped.forEach((s) => S.contacts.delete(s.id));
      } catch (e) {
        if (e.status) { chunk.forEach((c) => S.contacts.delete(c.id)); toast('Import stopped: ' + e.message); break; }
        // Offline: queue the rest so nothing is lost.
        enqueue({ kind: 'import', method: 'POST', url: '/api/contacts', body: { contacts: chunk } });
        inserted += chunk.length;
      }
      prog.firstElementChild.style.width = Math.round(((i + chunk.length) / all.length) * 100) + '%';
    }
    persist();
    IMP = null;
    toast(`Imported ${inserted} contact${inserted === 1 ? '' : 's'}${skipped ? ` · ${skipped} already existed` : ''}`);
    S.filter = 'all';
    S.sort = LS.get('sort', 'rank');
    go('leads');
  }

  /* ------------------------------------------------------------------ */
  /* Settings view                                                       */
  /* ------------------------------------------------------------------ */
  function renderSettings() {
    const v = $('#view-settings');
    const tpl = S.settings.waTemplate || DEFAULT_TEMPLATE;
    v.innerHTML = `
      <div class="panel"><h2>Pipeline</h2><div id="setStats" class="stats" style="margin:.4rem 0 0"></div></div>
      <div class="panel">
        <h2>WhatsApp message</h2>
        <p>Pre-filled when you tap WhatsApp on a lead. Shared with everyone using the app.</p>
        <div class="tokens">${['{first}', '{owner}', '{agency}', '{me}'].map((t) => `<button type="button" data-token="${t}">${t}</button>`).join('')}</div>
        <textarea id="waTpl" class="input" rows="5">${esc(tpl)}</textarea>
        <div class="preview-bubble" id="waPreview"></div>
        <div class="btn-row" style="margin-top:.7rem">
          <button class="btn" id="waReset">Reset</button>
          <button class="btn primary" id="waSave">Save message</button>
        </div>
      </div>
      <div class="panel">
        <h2>This phone</h2>
        <div class="form">
          <div class="field"><label for="meName">Your name</label>
            <input id="meName" value="${esc(S.me)}" placeholder="Shown as “added by” / “updated by”" maxlength="40"></div>
          <div class="field"><label for="ccIn">Default country code</label>
            <input id="ccIn" value="${esc(S.cc)}" inputmode="numeric" maxlength="4" placeholder="971">
            <div class="hint">Numbers like 050… are saved as +${esc(S.cc)} 50…</div></div>
          <div class="field"><label>WhatsApp opens via</label>
            <div class="seg" id="waMode">
              <button type="button" data-mode="web" class="${S.waMode === 'web' ? 'on' : ''}">wa.me link</button>
              <button type="button" data-mode="app" class="${S.waMode === 'app' ? 'on' : ''}">WhatsApp app</button>
            </div>
            <div class="hint">If WhatsApp doesn't open straight away from the home-screen app, try the other option.</div></div>
          <div class="field"><label>Text size</label>
            <div class="seg" id="zoomSeg">${ZOOMS.map((z, i) => `<button type="button" data-z="${i}" class="${S.zoom === i ? 'on' : ''}">${Math.round(z * 100)}</button>`).join('')}</div></div>
        </div>
      </div>
      <div class="panel">
        <h2>Data</h2>
        <p>Download every lead with its status and notes as a CSV (opens in Excel).</p>
        <div class="btn-row"><button class="btn" id="exportBtn">Export CSV</button><button class="btn" id="resyncBtn">Re-sync now</button></div>
      </div>
      <button class="btn ghost block danger" id="logout">Sign out of this phone</button>
      <p class="hint" style="text-align:center;margin-top:1rem">Sky High · ${S.contacts.size} leads · install it: Share → Add to Home Screen</p>`;
    renderSettingsStats();
    const ta = $('#waTpl');
    const sample = [...S.contacts.values()][0] || { owner: 'Ahmed Khan', agency: 'Example Realty' };
    const prev = () => ($('#waPreview').textContent = fillTemplate(ta.value, sample));
    ta.addEventListener('input', prev);
    prev();
    $$('[data-token]').forEach((b) => b.addEventListener('click', () => {
      const t = b.dataset.token;
      const s = ta.selectionStart ?? ta.value.length;
      ta.value = ta.value.slice(0, s) + t + ta.value.slice(ta.selectionEnd ?? s);
      ta.focus();
      ta.selectionStart = ta.selectionEnd = s + t.length;
      prev();
    }));
    $('#waReset').addEventListener('click', () => { ta.value = DEFAULT_TEMPLATE; prev(); });
    $('#waSave').addEventListener('click', () => {
      S.settings = { ...S.settings, waTemplate: ta.value.trim() || DEFAULT_TEMPLATE };
      persist();
      enqueue({ kind: 'settings', method: 'PUT', url: '/api/settings', body: { waTemplate: S.settings.waTemplate } });
      toast('Message saved for everyone');
    });
    $('#meName').addEventListener('change', (e) => { S.me = e.target.value.trim(); LS.set('me', S.me); toast('Name saved'); });
    $('#ccIn').addEventListener('change', (e) => { S.cc = e.target.value.replace(/\D/g, '') || '971'; LS.set('cc', S.cc); renderSettings(); });
    $('#waMode').addEventListener('click', (e) => {
      const b = e.target.closest('[data-mode]'); if (!b) return;
      S.waMode = b.dataset.mode; LS.set('waMode', S.waMode); renderSettings();
    });
    $('#zoomSeg').addEventListener('click', (e) => { const b = e.target.closest('[data-z]'); if (b) setZoom(Number(b.dataset.z)); });
    $('#exportBtn').addEventListener('click', exportCsv);
    $('#resyncBtn').addEventListener('click', async () => { await pull(true); toast('Synced'); renderSettingsStats(); });
    $('#logout').addEventListener('click', () => signOut());
  }

  function renderSettingsStats() {
    const el = $('#setStats');
    if (!el) return;
    const all = [...S.contacts.values()];
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const n = (k) => all.filter((c) => c.status === k).length;
    const calledToday = all.filter((c) => c.lastCalledAt >= today.getTime()).length;
    const addedToday = all.filter((c) => c.createdAt >= today.getTime()).length;
    el.innerHTML = [
      ['Total leads', all.length, ''], ['Added today', addedToday, ''], ['Called today', calledToday, ''],
      ['Positive', n('positive'), 'good'], ['Meetings', n('meeting_set') + n('meeting_done'), 'good'], ['Not called', n('new'), ''],
    ].map(([l, v, cls]) => `<div class="stat ${cls}"><b>${v}</b><span>${l}</span></div>`).join('');
  }

  function exportCsv() {
    const cell = (v) => { const s = String(v ?? ''); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
    const rows = [['Rank', 'Agency', 'Owner', 'Phone', 'Status', 'Notes', 'Calls', 'Last called', 'Added by', 'Added', 'Updated']];
    [...S.contacts.values()].sort((a, b) => (a.rank ?? 1e9) - (b.rank ?? 1e9)).forEach((c) => rows.push([
      c.rank ?? '', c.agency, c.owner, c.phone, ST[c.status]?.label || c.status, c.notes, c.callCount || 0,
      c.lastCalledAt ? new Date(c.lastCalledAt).toISOString() : '', c.addedBy, new Date(c.createdAt).toISOString(), new Date(c.updatedAt).toISOString(),
    ]));
    download(`sky-high-leads-${new Date().toISOString().slice(0, 10)}.csv`, '﻿' + rows.map((r) => r.map(cell).join(',')).join('\n'));
  }

  function download(name, text) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8' }));
    a.download = name;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  }

  /* ------------------------------------------------------------------ */
  /* Navigation, zoom, toast                                             */
  /* ------------------------------------------------------------------ */
  function go(view) {
    if (view === 'add') { openAdd(); return; }
    S.view = view;
    $$('.view').forEach((v) => (v.hidden = v.id !== 'view-' + view));
    $$('.bottom [data-nav]').forEach((b) => b.classList.toggle('on', b.dataset.nav === view));
    $('#leadsBar').hidden = view !== 'leads';
    $('#viewTitle').textContent = { leads: 'Leads', import: 'Import', settings: 'Settings' }[view];
    if (view === 'import') renderImport();
    if (view === 'settings') renderSettings();
    if (view === 'leads') { S.shown = PAGE; render(); }
    window.scrollTo(0, 0);
  }

  function setZoom(i) {
    S.zoom = Math.max(0, Math.min(ZOOMS.length - 1, i));
    LS.set('zoom', S.zoom);
    document.documentElement.style.setProperty('--z', ZOOMS[S.zoom]);
    $$('#zoomSeg [data-z]').forEach((b) => b.classList.toggle('on', Number(b.dataset.z) === S.zoom));
  }

  let toastTimer;
  function toast(msg, actionLabel, action, ms = 4500) {
    const t = $('#toast');
    t.innerHTML = `<span>${esc(msg)}</span>${actionLabel ? `<button type="button">${esc(actionLabel)}</button>` : ''}`;
    t.hidden = false;
    if (actionLabel) t.querySelector('button').onclick = () => { t.hidden = true; action(); };
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => (t.hidden = true), ms);
  }

  /* ------------------------------------------------------------------ */
  /* Auth                                                                */
  /* ------------------------------------------------------------------ */
  function signOut(expired) {
    S.token = '';
    LS.del('token');
    if (!expired) { LS.del('contacts'); LS.del('since'); LS.del('outbox'); S.contacts.clear(); S.outbox = []; S.since = 0; }
    showLogin(expired ? 'Please sign in again.' : '');
  }
  function showLogin(msg) {
    $('#app').hidden = true;
    $('#login').hidden = false;
    $('#loginErr').textContent = msg || '';
    $('#loginName').value = S.me || '';
  }
  async function tryOpenServer() {
    // If the server has no password set, sign straight in.
    try { const r = await api('POST', '/api/login', { password: '' }); if (r.open) return r.token; } catch {}
    return '';
  }

  $('#loginForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = e.target.querySelector('button');
    btn.disabled = true;
    $('#loginErr').textContent = '';
    try {
      const r = await api('POST', '/api/login', { password: $('#loginPass').value });
      S.token = r.token;
      LS.set('token', S.token);
      const name = $('#loginName').value.trim();
      if (name) { S.me = name; LS.set('me', name); }
      startApp();
    } catch (err) {
      $('#loginErr').textContent = err.status === 401 ? 'Wrong password' : 'Can’t reach the server — check your connection';
    } finally {
      btn.disabled = false;
    }
  });

  /* ------------------------------------------------------------------ */
  /* Global event wiring                                                 */
  /* ------------------------------------------------------------------ */
  document.addEventListener('click', (e) => {
    const nav = e.target.closest('[data-nav]');
    if (nav) { closeSheet(); go(nav.dataset.nav); return; }
    if (e.target.closest('[data-clear]')) { S.filter = 'all'; S.q = ''; $('#search').value = ''; render(); return; }
    const op = e.target.closest('[data-open]');
    if (op) { closeSheet(); openDetail(op.dataset.open); return; }
    const z = e.target.closest('[data-zoom]');
    if (z) { setZoom(S.zoom + Number(z.dataset.zoom)); return; }
    const chip = e.target.closest('[data-filter]');
    if (chip) {
      S.filter = chip.dataset.filter; LS.set('filter', S.filter); S.shown = PAGE; render();
      chip.scrollIntoView({ inline: 'center', block: 'nearest', behavior: 'smooth' });
      window.scrollTo({ top: 0 });
      return;
    }
    const act = e.target.closest('[data-act]');
    if (!act) return;
    const id = act.dataset.id || act.closest('[data-id]')?.dataset.id;
    if (!id) return;
    const kind = act.dataset.act;
    if (kind === 'call') onCall(id); // let the tel: link do its thing
    else if (kind === 'wa') onWa(id);
    else if (kind === 'status') { e.preventDefault(); openStatus(id); }
    else if (kind === 'open') openDetail(id);
  });

  $('#scrim').addEventListener('click', closeSheet);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !$('#sheet').hidden) closeSheet(); });
  // Swipe the sheet down to close.
  (() => {
    let y0 = null;
    const sh = $('#sheet');
    sh.addEventListener('touchstart', (e) => { y0 = sh.scrollTop <= 0 ? e.touches[0].clientY : null; }, { passive: true });
    sh.addEventListener('touchend', (e) => { if (y0 != null && e.changedTouches[0].clientY - y0 > 90) closeSheet(); y0 = null; }, { passive: true });
  })();

  let qTimer;
  $('#search').addEventListener('input', (e) => {
    clearTimeout(qTimer);
    qTimer = setTimeout(() => { S.q = e.target.value; S.shown = PAGE; renderList(); }, 120);
  });
  $('#sort').addEventListener('change', (e) => { S.sort = e.target.value; LS.set('sort', S.sort); renderList(); });
  $('#syncDot').addEventListener('click', () => { toast($('#syncDot').title); pull(); });

  // Infinite scroll.
  new IntersectionObserver((ents) => {
    if (ents[0].isIntersecting && S.view === 'leads' && filtered().length > S.shown) { S.shown += PAGE; renderList(); }
  }, { rootMargin: '600px' }).observe($('#more'));

  window.addEventListener('online', () => { S.online = true; flush().then(() => pull()); });
  window.addEventListener('offline', () => { S.online = false; setSync(); });

  /* ------------------------------------------------------------------ */
  /* Boot                                                                */
  /* ------------------------------------------------------------------ */
  let pollTimer;
  function startApp() {
    $('#login').hidden = true;
    $('#app').hidden = false;
    $('#sort').value = S.sort;
    go('leads');
    setSync();
    pull(!S.since);
    clearInterval(pollTimer);
    pollTimer = setInterval(() => { if (!document.hidden) pull(); }, POLL_MS);
  }

  setZoom(S.zoom);
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});

  (async () => {
    if (S.token) return startApp();
    const t = await tryOpenServer();
    if (t) { S.token = t; LS.set('token', t); return startApp(); }
    showLogin();
  })();
})();

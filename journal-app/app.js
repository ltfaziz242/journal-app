/* app.js — UI + penyimpanan lokal. Tanpa framework, tanpa jaringan. */
(function () {
  'use strict';

  const C = window.Calc;

  const LS = {
    settings: 'japp.settings.v1',
    trades: 'japp.trades.v1',
    meta: 'japp.meta.v1'
  };

  const WIB_OFFSET = 7 * 60 * 60 * 1000;
  const TAGS = ['FOMO', 'ikut sinyal', 'balas dendam', 'sesuai rencana', 'berita'];
  const BACKUP_DAYS = 7;

  const DEFAULT_SETTINGS = {
    accountType: 'demo',
    balances: { demo: null, live: null },
    defaultSymbol: 'XAUUSD',
    convCentPerUsdPerLot: null,
    setups: ['Breakout range Asia', 'Pullback EMA50'],
    rules: Object.assign({}, C.RULES_FIXED)
  };

  const DEFAULT_META = { lastBackupAt: null, sample: false };

  let state = {
    settings: clone(DEFAULT_SETTINGS),
    trades: [],
    meta: clone(DEFAULT_META),
    view: 'home'
  };

  /* ================= util ================= */

  function clone(o) { return JSON.parse(JSON.stringify(o)); }

  function load(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      if (!raw) return clone(fallback);
      const v = JSON.parse(raw);
      return (v && typeof v === 'object') ? v : clone(fallback);
    } catch (e) {
      return clone(fallback);
    }
  }

  function save(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
      return true;
    } catch (e) {
      alert('Gagal menyimpan ke perangkat ini (penyimpanan penuh atau diblokir).');
      return false;
    }
  }

  function persist() {
    save(LS.settings, state.settings);
    save(LS.trades, state.trades);
    save(LS.meta, state.meta);
  }

  function uid() {
    try {
      if (window.crypto && typeof window.crypto.randomUUID === 'function') return window.crypto.randomUUID();
    } catch (e) { /* jatuh ke cara lama */ }
    return 'id-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
  }

  /* ---------- waktu (WIB / UTC+7) ---------- */

  function wibParts(d) {
    const t = new Date(d.getTime() + WIB_OFFSET);
    return {
      y: t.getUTCFullYear(), m: t.getUTCMonth() + 1, d: t.getUTCDate(),
      h: t.getUTCHours(), mi: t.getUTCMinutes()
    };
  }

  function pad(n) { return String(n).padStart(2, '0'); }

  function wibKey(d) {
    const p = wibParts(d);
    return p.y + '-' + pad(p.m) + '-' + pad(p.d);
  }

  // Tanggal Senin untuk minggu berjalan (WIB).
  function wibWeekKey(d) {
    const dayIdx = Math.floor((d.getTime() + WIB_OFFSET) / 86400000);
    const dow = new Date(dayIdx * 86400000).getUTCDay(); // 0=Min
    const back = (dow + 6) % 7;
    const monday = new Date((dayIdx - back) * 86400000);
    return monday.toISOString().slice(0, 10);
  }

  function inputToInstant(v) {
    const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(v || '');
    if (!m) return null;
    return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]) - WIB_OFFSET);
  }

  function instantToInput(d) {
    const p = wibParts(d);
    return p.y + '-' + pad(p.m) + '-' + pad(p.d) + 'T' + pad(p.h) + ':' + pad(p.mi);
  }

  function fmtTime(d) {
    if (!d) return '—';
    const p = wibParts(d);
    return p.y + '-' + pad(p.m) + '-' + pad(p.d) + ' ' + pad(p.h) + ':' + pad(p.mi);
  }

  /* ---------- format angka ---------- */

  const nf0 = new Intl.NumberFormat('id-ID', { maximumFractionDigits: 0 });
  const nf2 = new Intl.NumberFormat('id-ID', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const nf4 = new Intl.NumberFormat('id-ID', { maximumFractionDigits: 4 });

  function cent(c) { return c == null ? '—' : nf2.format(c); }
  function usd(c) { return c == null ? '—' : nf2.format(c / 100); }
  function pct(v) { return v == null ? '—' : nf2.format(v) + '%'; }
  function rfmt(v) { return v == null ? '—' : (v > 0 ? '+' : '') + nf2.format(v) + 'R'; }
  function num(v) { return v == null ? '—' : nf4.format(v); }

  /* ================= turunan ================= */

  function accountType() { return state.settings.accountType === 'live' ? 'live' : 'demo'; }

  function startBalance(type) {
    const v = state.settings.balances ? state.settings.balances[type] : null;
    return (typeof v === 'number' && v > 0) ? v : null;
  }

  function closedOf(type) {
    return state.trades
      .filter((t) => t.accountType === type && t.status === 'closed')
      .sort((a, b) => new Date(a.closedAt) - new Date(b.closedAt));
  }

  function openTrades() {
    return state.trades.filter((t) => t.status === 'open')
      .sort((a, b) => new Date(a.openedAt) - new Date(b.openedAt));
  }

  function balanceOf(type) {
    const s = startBalance(type);
    if (s == null) return null;
    return s + C.sumCent(closedOf(type).map((t) => t.resultCent || 0));
  }

  function periodStats(type) {
    const closed = closedOf(type);
    const results = closed.map((t) => t.resultCent || 0);
    const rs = closed.map((t) => (t.resultR == null ? null : t.resultR)).filter((x) => x != null);
    const start = startBalance(type);

    const tagCount = {};
    for (const t of closed) for (const tg of (t.tags || [])) tagCount[tg] = (tagCount[tg] || 0) + 1;
    let topTag = null, topN = 0;
    for (const k of Object.keys(tagCount)) if (tagCount[k] > topN) { topN = tagCount[k]; topTag = k; }

    const followed = closed.filter((t) => t.rulesFollowed === true).length;

    return {
      n: closed.length,
      results,
      netCent: C.sumCent(results),
      winRate: C.winRate(results),
      expectancyR: C.expectancyR(rs),
      pf: C.profitFactor(results),
      maxDd: start ? C.maxDrawdownPct(start, results) : null,
      discipline: closed.length ? (followed / closed.length) * 100 : null,
      topTag, topTagN: topN,
      equity: start ? C.equitySeries(start, results) : null,
      balance: balanceOf(type),
      violations: closed.filter((t) => (t.violations || []).length > 0).length
    };
  }

  function todayKey() { return wibKey(new Date()); }
  function weekKey() { return wibWeekKey(new Date()); }

  function stopsForActive() {
    const type = accountType();
    const bal = balanceOf(type);
    if (bal == null) {
      return { dayPct: null, weekPct: null, tradesToday: 0, streak: 0, stopToday: false, stopWeek: false, reasons: [] };
    }
    const closed = closedOf(type);
    const today = todayKey();
    const week = weekKey();

    const todayNet = C.sumCent(closed.filter((t) => wibKey(new Date(t.closedAt)) === today).map((t) => t.resultCent || 0));
    const weekNet = C.sumCent(closed.filter((t) => wibWeekKey(new Date(t.closedAt)) === week).map((t) => t.resultCent || 0));
    const tradesToday = state.trades.filter((t) => t.accountType === type && wibKey(new Date(t.openedAt)) === today).length;
    const streak = C.trailingLosses(closed.map((t) => t.resultCent || 0));

    return C.stopStatus({
      todayNetCent: todayNet,
      weekNetCent: weekNet,
      balanceDayStartCent: bal - todayNet,
      balanceWeekStartCent: bal - weekNet,
      tradesToday, trailingLosses: streak,
      rules: state.settings.rules || C.RULES_FIXED
    });
  }

  /* ================= DOM helper ================= */

  function h(tag, attrs) {
    const n = document.createElement(tag);
    if (attrs) {
      for (const k of Object.keys(attrs)) {
        const v = attrs[k];
        if (v == null) continue;
        if (k === 'class') n.className = v;
        else if (k === 'text') n.textContent = v;
        else if (k === 'value') n.value = v;
        else if (k === 'checked') n.checked = !!v;
        else if (k.startsWith('on') && typeof v === 'function') n.addEventListener(k.slice(2), v);
        else n.setAttribute(k, v);
      }
    }
    for (let i = 2; i < arguments.length; i++) {
      const kid = arguments[i];
      if (kid == null) continue;
      if (Array.isArray(kid)) { for (const k2 of kid) if (k2 != null) n.append(k2.nodeType ? k2 : document.createTextNode(String(k2))); }
      else n.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
    }
    return n;
  }

  function $(id) { return document.getElementById(id); }
  function clear(node) { while (node.firstChild) node.removeChild(node.firstChild); }

  function kvRow(k, v, cls) {
    return [h('span', { class: 'k', text: k }), h('span', { class: 'v ' + (cls || ''), text: v })];
  }

  function kv(container, rows) {
    clear(container);
    for (const [k, v, cls] of rows) {
      container.append(h('span', { class: 'k', text: k }));
      container.append(h('span', { class: 'v ' + (cls || ''), text: v }));
    }
  }

  function banner(kind, title, lines) {
    const b = h('div', { class: 'banner banner-' + kind });
    b.append(h('div', { text: title }));
    if (lines && lines.length) {
      const ul = h('ul');
      for (const l of lines) ul.append(h('li', { text: l }));
      b.append(ul);
    }
    return b;
  }

  /* ================= navigasi ================= */

  function switchView(name) {
    state.view = name;
    for (const sec of document.querySelectorAll('.view')) {
      sec.classList.toggle('is-active', sec.id === 'view-' + name);
    }
    for (const tab of document.querySelectorAll('.tab')) {
      tab.classList.toggle('is-active', tab.dataset.view === name);
    }
    if (name === 'home') renderHome();
    if (name === 'new') renderNew();
    if (name === 'close') renderClose();
    if (name === 'log') renderLog();
    if (name === 'settings') renderSettings();
    if (name === 'backup') renderBackup();
    window.scrollTo(0, 0);
  }

  /* ================= header ================= */

  function renderHeader() {
    const type = accountType();
    $('hdr-sub').textContent = (state.settings.defaultSymbol || 'XAUUSD') + ' · akun ' + type;
    const bal = balanceOf(type);
    $('hdr-balance').textContent = 'saldo: ' + (bal == null ? '—' : cent(bal) + ' cent');
  }

  /* ================= BERANDA ================= */

  function renderHome() {
    renderHeader();
    const type = accountType();
    const stops = stopsForActive();
    const bal = balanceOf(type);

    const banners = $('home-banners');
    clear(banners);

    if (stops.stopWeek) {
      banners.append(banner('bad', 'STOP MINGGU INI', stops.reasons));
    } else if (stops.stopToday) {
      banners.append(banner('bad', 'STOP HARI INI', stops.reasons));
    } else {
      banners.append(banner('good', 'Tidak ada batas yang tercapai. Tetap pakai checklist.', []));
    }

    // pengingat backup
    const days = backupAgeDays();
    if (state.trades.length && (days == null || days >= BACKUP_DAYS)) {
      const b = banner('warn', 'Waktunya backup', [
        days == null ? 'Belum pernah backup. Data hanya ada di HP ini.' : 'Sudah ' + days + ' hari sejak backup terakhir.'
      ]);
      const btn = h('button', { class: 'btn btn-ghost btn-sm', type: 'button', text: 'Buka backup' });
      btn.addEventListener('click', () => switchView('backup'));
      b.append(btn);
      banners.append(b);
    }

    $('home-day-loss').textContent = stops.dayPct == null ? '—' : pct(stops.dayPct);
    $('home-day-limit').textContent = 'batas 3% · ' +
      (bal == null ? 'saldo belum diisi' : 'saldo ' + cent(bal) + ' cent');
    $('home-week-loss').textContent = stops.weekPct == null ? '—' : pct(stops.weekPct);
    $('home-week-limit').textContent = 'batas 6%';

    $('home-day-count').textContent = stops.tradesToday + ' / ' + (state.settings.rules.maxTradesPerDay);
    $('home-streak').textContent = stops.streak + ' / ' + (state.settings.rules.maxConsecLoss);

    renderStatsCard('demo');
    renderStatsCard('live');

    const setups = state.settings.setups || [];
    $('home-setup-hint').textContent = setups.length
      ? 'Setup tersimpan: ' + setups.join(' · ')
      : 'Belum ada setup tersimpan. Tambahkan di Pengaturan.';
  }

  function renderStatsCard(type) {
    const s = periodStats(type);
    const body = $('stats-' + type + '-body');
    const prog = $('stats-' + type + '-progress');
    prog.textContent = s.n + '/100 trade';

    kv(body, [
      ['Total trade selesai', String(s.n)],
      ['Net', (s.netCent > 0 ? '+' : '') + cent(s.netCent) + ' cent', s.netCent > 0 ? 'pos' : (s.netCent < 0 ? 'neg' : '')],
      ['Win rate', s.winRate == null ? '—' : pct(s.winRate)],
      ['Expectancy', s.expectancyR == null ? '—' : rfmt(s.expectancyR)],
      ['Profit factor', s.pf == null ? '—' : nf2.format(s.pf)],
      ['Max drawdown', s.maxDd == null ? '—' : pct(s.maxDd)],
      ['Disiplin (taat aturan)', s.discipline == null ? '—' : pct(s.discipline)],
      ['Tag terbanyak', s.topTag ? s.topTag + ' (' + s.topTagN + ')' : '—'],
      ['Trade melanggar', String(s.violations)]
    ]);

    renderEquity($('equity-' + type), s.equity, state.settings.balances ? state.settings.balances[type] : null);
  }

  function renderEquity(container, series, start) {
    const NS = 'http://www.w3.org/2000/svg';
    clear(container);
    if (!series || series.length < 2 || !(start > 0)) {
      container.append(h('p', { class: 'empty', text: 'Kurva equity muncul setelah ada trade selesai.' }));
      return;
    }
    const W = 300, H = 90, P = 6;
    const vals = series.map((p) => p.equity);
    const min = Math.min.apply(null, vals.concat([start]));
    const max = Math.max.apply(null, vals.concat([start]));
    const span = (max - min) || 1;
    const x = (i) => P + (i * (W - 2 * P)) / (vals.length - 1);
    const y = (v) => H - P - ((v - min) / span) * (H - 2 * P);

    const svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('viewBox', '0 0 ' + W + ' ' + H);
    svg.setAttribute('preserveAspectRatio', 'none');
    svg.setAttribute('role', 'img');

    // garis saldo awal
    const base = document.createElementNS(NS, 'line');
    base.setAttribute('x1', String(P)); base.setAttribute('x2', String(W - P));
    base.setAttribute('y1', y(start).toFixed(2)); base.setAttribute('y2', y(start).toFixed(2));
    base.setAttribute('stroke', '#2a3341'); base.setAttribute('stroke-width', '1');
    base.setAttribute('stroke-dasharray', '4 4');
    svg.append(base);

    const poly = document.createElementNS(NS, 'polyline');
    poly.setAttribute('points', vals.map((v, i) => x(i).toFixed(2) + ',' + y(v).toFixed(2)).join(' '));
    poly.setAttribute('fill', 'none');
    poly.setAttribute('stroke', vals[vals.length - 1] >= start ? '#31c48d' : '#ef5350');
    poly.setAttribute('stroke-width', '2');
    poly.setAttribute('stroke-linejoin', 'round');
    svg.append(poly);

    container.append(svg);
    container.append(h('p', { class: 'muted small', text: 'Awal ' + cent(start) + ' → akhir ' + cent(vals[vals.length - 1]) + ' cent' }));
  }

  function backupAgeDays() {
    if (!state.meta.lastBackupAt) return null;
    const ms = Date.now() - new Date(state.meta.lastBackupAt).getTime();
    return Math.floor(ms / 86400000);
  }

  /* ================= TRADE BARU ================= */

  function renderSetupOptions(select) {
    clear(select);
    const setups = state.settings.setups || [];
    if (!setups.length) {
      select.append(h('option', { value: '', text: '— belum ada setup, tambahkan —' }));
      return;
    }
    select.append(h('option', { value: '', text: 'Pilih setup…' }));
    for (const s of setups) select.append(h('option', { value: s, text: s }));
  }

  function buildChecklist() {
    const ul = $('nt-checklist');
    clear(ul);
    for (const item of C.CHECKLIST) {
      const cb = h('input', { type: 'checkbox', id: 'chk-' + item.id });
      cb.addEventListener('change', updateNewCalc);
      ul.append(h('li', null, h('label', { class: 'chk', for: 'chk-' + item.id }, cb, item.full)));
    }
  }

  function readChecklist() {
    const out = {};
    for (const item of C.CHECKLIST) {
      const el = $('chk-' + item.id);
      out[item.id] = !!(el && el.checked);
    }
    return out;
  }

  function readNewForm() {
    return {
      timeStr: $('nt-time').value,
      symbol: $('nt-symbol').value.trim().toUpperCase(),
      dir: $('nt-dir').value,
      setup: $('nt-setup').value,
      entry: C.parseNum($('nt-entry').value),
      sl: C.parseNum($('nt-sl').value),
      tp: C.parseNum($('nt-tp').value),
      lot: C.parseNum($('nt-lot').value),
      checklist: readChecklist()
    };
  }

  function renderNew() {
    renderHeader();
    if (!$('nt-time').value) $('nt-time').value = instantToInput(new Date());
    if (!$('nt-symbol').value) $('nt-symbol').value = state.settings.defaultSymbol || 'XAUUSD';
    renderSetupOptions($('nt-setup'));
    if (!document.querySelector('#nt-checklist input')) buildChecklist();
    updateNewCalc();
  }

  function updateNewCalc() {
    const f = readNewForm();
    const type = accountType();
    const bal = balanceOf(type);
    const conv = state.settings.convCentPerUsdPerLot;

    const d = C.slDistance(f.entry, f.sl);
    const rrV = C.rr(f.entry, f.sl, f.tp);
    const riskC = C.riskCent(d, f.lot, conv);
    const rp = riskC != null && bal ? C.riskPct(riskC, bal) : null;

    kv($('nt-calc'), [
      ['Jarak SL', d == null ? '—' : num(d) + ' USD'],
      ['RR', rrV == null ? '—' : nf2.format(rrV) + ' : 1', rrV != null && rrV >= 1.5 ? 'pos' : (rrV != null ? 'neg' : '')],
      ['Risiko', riskC == null ? '— (data konversi belum diisi)' : cent(riskC) + ' cent'],
      ['Risiko % saldo', rp == null ? '—' : pct(rp), rp != null && rp > 0.5 ? 'neg' : (rp != null ? 'pos' : '')],
      ['Saldo acuan', bal == null ? '— (isi saldo awal)' : cent(bal) + ' cent']
    ]);

    const stops = stopsForActive();
    const failures = C.entryFailures({
      settings: state.settings, balanceCent: bal,
      entry: f.entry, sl: f.sl, tp: f.tp, lot: f.lot, dir: f.dir,
      checklist: f.checklist, stops: stops.stopToday ? stops : null
    });

    const box = $('new-banner');
    clear(box);
    if (failures.length) {
      box.append(banner('bad', 'JANGAN ENTRY', failures.map((x) => x.text)));
    } else {
      box.append(banner('good', 'Checklist lengkap & aturan terpenuhi.', []));
    }
    return { f, d, rrV, riskC, rp, bal, failures, stops };
  }

  function saveNewTrade(ev) {
    ev.preventDefault();
    const calc = updateNewCalc();
    const f = calc.f;

    if (!f.timeStr) { alert('Waktu belum diisi.'); return; }
    if (!f.symbol) { alert('Simbol belum diisi.'); return; }
    if (!(f.entry > 0) || !(f.sl > 0) || !(f.tp > 0)) { alert('Entry, SL, dan TP harus angka valid.'); return; }
    if (!(f.lot > 0)) { alert('Lot harus lebih besar dari 0.'); return; }
    if (!(calc.d > 0)) { alert('Jarak SL tidak boleh 0 (SL sama dengan entry).'); return; }

    const opened = inputToInstant(f.timeStr);
    if (!opened) { alert('Format waktu tidak dikenali.'); return; }

    const trade = {
      id: uid(),
      accountType: accountType(),
      openedAt: opened.toISOString(),
      createdAt: new Date().toISOString(),
      symbol: f.symbol,
      dir: f.dir,
      setup: f.setup || '',
      entry: f.entry, sl: f.sl, tp: f.tp, lot: f.lot,
      slDist: calc.d,
      rr: calc.rrV,
      riskCent: calc.riskC,
      riskPct: calc.rp,
      balanceAtOpenCent: calc.bal,
      convAtOpen: state.settings.convCentPerUsdPerLot,
      checklist: f.checklist,
      violations: calc.failures.map((x) => ({ code: x.code, text: x.text })),
      status: 'open',
      closedAt: null, resultCent: null, resultR: null, exitPrice: null,
      rulesFollowed: null, tags: [], note: ''
    };

    state.trades.push(trade);
    persist();

    resetNewForm();
    switchView('log');
    renderLog();
    const note = trade.violations.length
      ? 'Tersimpan dengan tanda MELANGGAR ATURAN (' + trade.violations.length + ' pelanggaran).'
      : 'Tersimpan.';
    $('log-list').prepend(banner(trade.violations.length ? 'warn' : 'good', note, []));
  }

  function resetNewForm() {
    $('nt-time').value = instantToInput(new Date());
    const sym = state.settings.defaultSymbol || 'XAUUSD';
    $('nt-symbol').value = sym;
    $('nt-dir').value = 'BUY';
    $('nt-setup').value = '';
    $('nt-entry').value = '';
    $('nt-sl').value = '';
    $('nt-tp').value = '';
    $('nt-lot').value = '';
    for (const item of C.CHECKLIST) {
      const el = $('chk-' + item.id);
      if (el) el.checked = false;
    }
    updateNewCalc();
  }

  /* ================= TUTUP TRADE ================= */

  function renderClose() {
    renderHeader();
    const sel = $('cl-select');
    const list = openTrades();
    clear(sel);
    if (!list.length) {
      sel.append(h('option', { value: '', text: '— tidak ada trade terbuka —' }));
      kv($('cl-info'), [['Info', 'Buka trade baru dulu.']]);
      renderCloseTags();
      updateCloseR();
      return;
    }
    for (const t of list) {
      const label = fmtTime(new Date(t.openedAt)) + ' · ' + t.symbol + ' ' + t.dir +
        ' · ' + t.lot + ' lot' + (t.setup ? ' · ' + t.setup : '');
      sel.append(h('option', { value: t.id, text: label }));
    }
    renderCloseTags();
    renderCloseInfo();
    updateCloseR();
  }

  function selectedOpenTrade() {
    const id = $('cl-select').value;
    if (!id) return null;
    return state.trades.find((t) => t.id === id && t.status === 'open') || null;
  }

  function renderCloseInfo() {
    const t = selectedOpenTrade();
    if (!t) { kv($('cl-info'), []); return; }
    kv($('cl-info'), [
      ['Masuk', fmtTime(new Date(t.openedAt))],
      ['Entry / SL / TP', num(t.entry) + ' / ' + num(t.sl) + ' / ' + num(t.tp)],
      ['Jarak SL', num(t.slDist) + ' USD'],
      ['RR rencana', t.rr == null ? '—' : nf2.format(t.rr) + ' : 1'],
      ['Risiko (saat buka)', t.riskCent == null ? '— (data konversi kosong)' : cent(t.riskCent) + ' cent'],
      ['Melanggar aturan', (t.violations || []).length ? String(t.violations.length) + ' poin' : 'tidak']
    ]);
  }

  function renderCloseTags() {
    const box = $('cl-tags');
    clear(box);
    for (const tag of TAGS) {
      const cb = h('input', { type: 'checkbox', value: tag, id: 'tag-' + tag.replace(/\s+/g, '-') });
      box.append(h('label', { class: 'radio', for: 'tag-' + tag.replace(/\s+/g, '-') }, cb, tag));
    }
  }

  function updateCloseR() {
    const t = selectedOpenTrade();
    const val = C.parseNum($('cl-result').value);
    if (!t || val == null) { $('cl-r').textContent = '—'; return; }
    const r = t.riskCent > 0 ? C.resultR(val, t.riskCent) : null;
    $('cl-r').textContent = r == null ? '— (risiko tidak tercatat)' : rfmt(r);
  }

  function saveClose(ev) {
    ev.preventDefault();
    const t = selectedOpenTrade();
    if (!t) { alert('Pilih trade terbuka dulu.'); return; }
    const val = C.parseNum($('cl-result').value);
    if (val == null) { alert('Hasil (cent) harus angka. Boleh minus, contoh -2500.'); return; }

    const exitPrice = C.parseNum($('cl-exit').value);
    const radio = document.querySelector('input[name="cl-rules"]:checked');
    const follow = radio ? radio.value === 'yes' : null;
    const tags = [];
    for (const cb of document.querySelectorAll('#cl-tags input[type="checkbox"]')) {
      if (cb.checked) tags.push(cb.value);
    }

    t.status = 'closed';
    t.closedAt = new Date().toISOString();
    t.resultCent = val;
    t.resultR = t.riskCent > 0 ? C.resultR(val, t.riskCent) : null;
    t.exitPrice = exitPrice;
    t.rulesFollowed = follow;
    t.tags = tags;
    t.note = $('cl-note').value.trim().slice(0, 300);

    persist();
    $('cl-result').value = '';
    $('cl-exit').value = '';
    $('cl-note').value = '';
    for (const cb of document.querySelectorAll('#cl-tags input[type="checkbox"]')) cb.checked = false;
    const yes = document.querySelector('input[name="cl-rules"][value="yes"]');
    if (yes) yes.checked = true;

    switchView('home');
  }

  /* ================= JURNAL ================= */

  function renderLog() {
    renderHeader();
    const filter = $('log-filter').value;
    const list = $('log-list');
    clear(list);

    let trades = state.trades.slice().sort((a, b) => new Date(b.openedAt) - new Date(a.openedAt));
    if (filter === 'open') trades = trades.filter((t) => t.status === 'open');
    if (filter === 'closed') trades = trades.filter((t) => t.status === 'closed');
    if (filter === 'violation') trades = trades.filter((t) => (t.violations || []).length > 0);

    $('log-count').textContent = String(trades.length);

    if (!trades.length) {
      list.append(h('p', { class: 'muted', text: 'Belum ada trade pada filter ini.' }));
      return;
    }

    for (const t of trades) {
      const closed = t.status === 'closed';
      const resClass = t.resultCent == null ? '' : (t.resultCent > 0 ? 'pos' : (t.resultCent < 0 ? 'neg' : ''));
      const card = h('div', { class: 'trade' + ((t.violations || []).length ? ' violation' : '') });

      const head = h('div', { class: 'trade-head' });
      head.append(h('div', null,
        h('span', { class: 'trade-dir dir-' + (t.dir === 'BUY' ? 'buy' : 'sell'), text: t.symbol + ' ' + t.dir }),
        h('p', { class: 'trade-meta', text: fmtTime(new Date(t.openedAt)) + (t.setup ? ' · ' + t.setup : '') })
      ));
      head.append(h('div', { class: 'v ' + resClass, text: closed ? (t.resultCent > 0 ? '+' : '') + cent(t.resultCent) + ' cent' : 'terbuka' }));
      card.append(head);

      const rows = [
        ['Entry / SL / TP', num(t.entry) + ' / ' + num(t.sl) + ' / ' + num(t.tp)],
        ['Lot', String(t.lot)],
        ['Jarak SL', t.slDist == null ? '—' : num(t.slDist)],
        ['RR', t.rr == null ? '—' : nf2.format(t.rr) + ' : 1'],
        ['Risiko', t.riskCent == null ? '—' : cent(t.riskCent) + ' cent (' + pct(t.riskPct) + ')']
      ];
      if (closed) {
        rows.push(['Hasil (R)', rfmt(t.resultR)]);
        rows.push(['Taat aturan', t.rulesFollowed === true ? 'ya' : (t.rulesFollowed === false ? 'TIDAK' : '—')]);
        if (t.exitPrice != null) rows.push(['Harga keluar', num(t.exitPrice)]);
        rows.push(['Akun', t.accountType]);
      }
      const grid = h('div', { class: 'kv' });
      kv(grid, rows);
      card.append(grid);

      if ((t.violations || []).length) {
        card.append(h('p', { class: 'small neg', text: 'MELANGGAR ATURAN: ' + t.violations.map((v) => v.text).join(' · ') }));
      }
      if ((t.tags || []).length) {
        const tg = h('div', { class: 'trade-tags' });
        for (const x of t.tags) tg.append(h('span', { class: 'tagpill', text: x }));
        card.append(tg);
      }
      if (t.note) card.append(h('p', { class: 'muted small', text: t.note }));

      const del = h('button', { class: 'btn btn-ghost btn-sm', type: 'button', text: 'Hapus' });
      del.addEventListener('click', () => {
        if (!confirm('Hapus trade ini dari jurnal? Tidak bisa dibatalkan.')) return;
        state.trades = state.trades.filter((x) => x.id !== t.id);
        persist();
        renderLog();
        renderHeader();
      });
      card.append(h('div', { class: 'row' }, del));
      list.append(card);
    }
  }

  /* ================= PENGATURAN ================= */

  function renderSettings() {
    renderHeader();
    const s = state.settings;
    const type = accountType();

    $('st-account-type').value = type;
    $('st-balance-label').textContent = 'Saldo awal akun ' + type.toUpperCase() + ' (cent)';
    const bal = s.balances ? s.balances[type] : null;
    $('st-balance').value = bal == null ? '' : String(bal);
    $('st-symbol').value = s.defaultSymbol || 'XAUUSD';
    $('st-conv').value = s.convCentPerUsdPerLot == null ? '' : String(s.convCentPerUsdPerLot);

    renderSetupList();
    updateConvPreview();
  }

  function renderSetupList() {
    const ul = $('st-setups');
    clear(ul);
    const setups = state.settings.setups || [];
    if (!setups.length) {
      ul.append(h('li', { class: 'muted', text: 'Belum ada setup.' }));
      return;
    }
    for (const name of setups) {
      const del = h('button', { class: 'btn btn-ghost btn-sm', type: 'button', text: 'Hapus' });
      del.addEventListener('click', () => {
        state.settings.setups = (state.settings.setups || []).filter((x) => x !== name);
        persist();
        renderSetupList();
        renderSetupOptions($('nt-setup'));
      });
      ul.append(h('li', null, h('span', { text: name }), del));
    }
  }

  function updateConvPreview() {
    const v = C.parseNum($('st-conv').value);
    const el = $('st-conv-preview');
    if (!(v > 0)) { el.textContent = 'Belum diisi — risiko tidak bisa dihitung.'; return; }
    el.textContent = 'Contoh: SL 1,00 USD × 1,00 lot = ' + cent(1 * 1 * v) + ' cent (' + usd(v) + ' USD). ' +
      'SL 5,00 USD × 0,50 lot = ' + cent(5 * 0.5 * v) + ' cent.';
  }

  function saveSettings(ev) {
    ev.preventDefault();
    const type = $('st-account-type').value === 'live' ? 'live' : 'demo';
    const balRaw = $('st-balance').value.trim();
    const bal = balRaw === '' ? null : C.parseNum(balRaw);
    if (balRaw !== '' && (!(bal > 0) || Math.round(bal) !== bal)) {
      alert('Saldo awal harus angka bulat > 0 (cent).');
      return;
    }
    const convRaw = $('st-conv').value.trim();
    const conv = convRaw === '' ? null : C.parseNum(convRaw);
    if (convRaw !== '' && !(conv > 0)) {
      alert('Data konversi harus angka > 0 (cent).');
      return;
    }

    state.settings.accountType = type;
    state.settings.balances = state.settings.balances || { demo: null, live: null };
    state.settings.balances[type] = bal == null ? null : Math.round(bal);
    state.settings.defaultSymbol = ($('st-symbol').value.trim() || 'XAUUSD').toUpperCase();
    state.settings.convCentPerUsdPerLot = conv;

    persist();
    renderSettings();
    renderHeader();
    alert('Pengaturan disimpan.');
  }

  /* ================= BACKUP ================= */

  function renderBackup() {
    renderHeader();
    const days = backupAgeDays();
    const el = $('bk-status');
    if (!state.meta.lastBackupAt) el.textContent = 'Belum pernah backup.';
    else el.textContent = 'Backup terakhir: ' + fmtTime(new Date(state.meta.lastBackupAt)) +
      ' WIB (' + (days === 0 ? 'hari ini' : days + ' hari lalu') + ').';
  }

  function download(filename, text, mime) {
    const blob = new Blob([text], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = h('a', { href: url, download: filename });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }

  function exportJson() {
    const payload = {
      app: 'jurnal-xau',
      version: 1,
      exportedAt: new Date().toISOString(),
      settings: state.settings,
      trades: state.trades,
      meta: { sample: !!state.meta.sample }
    };
    download('jurnal-trading-' + wibKey(new Date()) + '.json', JSON.stringify(payload, null, 2), 'application/json');
    state.meta.lastBackupAt = new Date().toISOString();
    persist();
    renderBackup();
  }

  function csvCell(v) {
    let s = v == null ? '' : String(v);
    // cegah formula injection di spreadsheet
    if (/^[=+@\t\r]/.test(s) || (/^-/.test(s) && !/^-?\d+(?:[.,]\d+)?$/.test(s))) s = "'" + s;
    if (/[",;\n\r]/.test(s)) s = '"' + s.replace(/"/g, '""') + '"';
    return s;
  }

  function exportCsv() {
    const head = ['tanggal', 'pair', 'arah', 'entry', 'SL', 'TP', 'alasan', 'hasil_cent', 'hasil_R', 'taat_aturan', 'tag', 'tipe_akun'];
    const rows = [head.join(',')];
    const list = state.trades.slice().sort((a, b) => new Date(a.openedAt) - new Date(b.openedAt));
    for (const t of list) {
      rows.push([
        csvCell(fmtTime(new Date(t.openedAt))),
        csvCell(t.symbol),
        csvCell(t.dir),
        csvCell(t.entry),
        csvCell(t.sl),
        csvCell(t.tp),
        csvCell(t.setup || ''),
        csvCell(t.resultCent == null ? '' : Math.round(t.resultCent)),
        csvCell(t.resultR == null ? '' : (Math.round(t.resultR * 100) / 100)),
        csvCell(t.rulesFollowed === true ? 'ya' : (t.rulesFollowed === false ? 'tidak' : '')),
        csvCell((t.tags || []).join('|')),
        csvCell(t.accountType)
      ].join(','));
    }
    download('jurnal-trading-' + wibKey(new Date()) + '.csv', rows.join('\r\n') + '\r\n', 'text/csv');
    state.meta.lastBackupAt = new Date().toISOString();
    persist();
    renderBackup();
  }

  function importJson() {
    const file = $('bk-file').files && $('bk-file').files[0];
    if (!file) { alert('Pilih file JSON dulu.'); return; }
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const data = JSON.parse(String(reader.result));
        if (!data || !Array.isArray(data.trades)) throw new Error('Format tidak dikenali');
        if (!confirm('Import akan MENGGANTI semua data di perangkat ini. Lanjut?')) return;
        state.trades = data.trades.filter((t) => t && t.id && t.symbol && t.dir).map(normalizeTrade);
        if (data.settings && typeof data.settings === 'object') {
          state.settings = Object.assign(clone(DEFAULT_SETTINGS), data.settings);
          state.settings.rules = Object.assign({}, C.RULES_FIXED);
          state.settings.balances = state.settings.balances || { demo: null, live: null };
          if (!Array.isArray(state.settings.setups)) state.settings.setups = [];
        }
        state.meta.sample = !!(data.meta && data.meta.sample);
        state.meta.lastBackupAt = new Date().toISOString();
        persist();
        renderAll();
        alert('Import selesai: ' + state.trades.length + ' trade.');
      } catch (e) {
        alert('Gagal import: ' + (e && e.message ? e.message : 'file tidak valid'));
      }
    };
    reader.readAsText(file);
  }

  function normalizeTrade(t) {
    return Object.assign({
      id: uid(), accountType: 'demo', openedAt: new Date().toISOString(), createdAt: new Date().toISOString(),
      symbol: 'XAUUSD', dir: 'BUY', setup: '', entry: 0, sl: 0, tp: 0, lot: 0,
      slDist: null, rr: null, riskCent: null, riskPct: null, balanceAtOpenCent: null, convAtOpen: null,
      checklist: {}, violations: [], status: 'open', closedAt: null, resultCent: null, resultR: null,
      exitPrice: null, rulesFollowed: null, tags: [], note: ''
    }, t);
  }

  function wipeAll() {
    if (!confirm('Hapus SEMUA data (pengaturan + trade) di perangkat ini? Tidak bisa dibatalkan.')) return;
    state.settings = clone(DEFAULT_SETTINGS);
    state.trades = [];
    state.meta = clone(DEFAULT_META);
    persist();
    renderAll();
    alert('Semua data dihapus.');
  }

  /* ================= DATA CONTOH ================= */

  function fillSample() {
    if (!confirm('Isi data contoh? Data ini palsu, hanya untuk melihat tampilan. Bisa dihapus lagi.')) return;

    // pastikan konversi & saldo terisi supaya hitungan bermakna
    if (!(state.settings.convCentPerUsdPerLot > 0)) state.settings.convCentPerUsdPerLot = 10000;
    if (!(state.settings.balances.demo > 0)) state.settings.balances.demo = 8618740;
    state.settings.accountType = 'demo';

    const conv = state.settings.convCentPerUsdPerLot;
    const bal = state.settings.balances.demo;

    const plan = [
      { d: 13, dir: 'BUY',  entry: 2648.4, sl: 2642.1, tp: 2657.9, lot: 0.5, resR: 1.5, rules: true,  tags: ['sesuai rencana'] },
      { d: 12, dir: 'SELL', entry: 2661.2, sl: 2667.0, tp: 2652.5, lot: 0.4, resR: -1,  rules: true,  tags: ['sesuai rencana', 'berita'] },
      { d: 12, dir: 'BUY',  entry: 2655.8, sl: 2650.2, tp: 2664.1, lot: 0.6, resR: -1,  rules: false, tags: ['FOMO'] },
      { d: 11, dir: 'BUY',  entry: 2641.7, sl: 2636.0, tp: 2650.0, lot: 0.5, resR: 1.5, rules: true,  tags: ['sesuai rencana'] },
      { d: 10, dir: 'SELL', entry: 2652.9, sl: 2658.4, tp: 2644.6, lot: 0.5, resR: -1,  rules: true,  tags: ['sesuai rencana'] },
      { d: 9,  dir: 'BUY',  entry: 2639.5, sl: 2633.8, tp: 2647.8, lot: 0.7, resR: 1.5, rules: true,  tags: ['sesuai rencana'] },
      { d: 8,  dir: 'BUY',  entry: 2633.1, sl: 2627.4, tp: 2641.4, lot: 0.5, resR: -1,  rules: false, tags: ['balas dendam'] },
      { d: 7,  dir: 'SELL', entry: 2646.8, sl: 2652.6, tp: 2638.0, lot: 0.4, resR: 1.5, rules: true,  tags: ['sesuai rencana'] },
      { d: 6,  dir: 'BUY',  entry: 2650.2, sl: 2644.5, tp: 2658.5, lot: 0.5, resR: 1.5, rules: true,  tags: ['sesuai rencana'] },
      { d: 5,  dir: 'SELL', entry: 2663.4, sl: 2669.1, tp: 2654.7, lot: 0.5, resR: -1,  rules: true,  tags: ['ikut sinyal'] },
      { d: 4,  dir: 'BUY',  entry: 2657.0, sl: 2651.3, tp: 2665.3, lot: 0.5, resR: 1.5, rules: true,  tags: ['sesuai rencana'] },
      { d: 3,  dir: 'BUY',  entry: 2668.5, sl: 2662.8, tp: 2676.8, lot: 0.6, resR: -1,  rules: false, tags: ['FOMO', 'ikut sinyal'] },
      { d: 2,  dir: 'SELL', entry: 2671.9, sl: 2677.7, tp: 2663.2, lot: 0.5, resR: 1.5, rules: true,  tags: ['sesuai rencana'] },
      { d: 1,  dir: 'BUY',  entry: 2662.4, sl: 2656.7, tp: 2670.7, lot: 0.5, resR: 1.5, rules: true,  tags: ['sesuai rencana'] }
    ];

    const now = Date.now();
    const made = [];
    for (const p of plan) {
      const opened = new Date(now - p.d * 86400000);
      opened.setUTCHours(4, 0, 0, 0);   // 11:00 WIB
      const slDist = Math.abs(p.entry - p.sl);
      const riskC = slDist * p.lot * conv;
      const closedAt = new Date(opened.getTime() + 3 * 3600 * 1000);
      made.push({
        id: 'sample-' + made.length + '-' + uid(),
        accountType: 'demo',
        openedAt: opened.toISOString(),
        createdAt: opened.toISOString(),
        symbol: 'XAUUSD', dir: p.dir, setup: 'Breakout range Asia',
        entry: p.entry, sl: p.sl, tp: p.tp, lot: p.lot,
        slDist, rr: Math.abs(p.tp - p.entry) / slDist,
        riskCent: riskC, riskPct: (riskC / bal) * 100,
        balanceAtOpenCent: bal, convAtOpen: conv,
        checklist: { setup: true, sl: true, rr: true, risk: true, news: true, emotion: true, own: true },
        violations: p.rules ? [] : [{ code: 'x', text: 'Contoh: checklist tidak lengkap' }],
        status: 'closed',
        closedAt: closedAt.toISOString(),
        resultCent: Math.round(p.resR * riskC),
        resultR: p.resR,
        exitPrice: p.resR > 0 ? p.tp : p.sl,
        rulesFollowed: p.rules,
        tags: p.tags,
        note: 'Data contoh',
        sample: true
      });
    }

    // 1 trade terbuka
    const openAt = new Date(now - 3600 * 1000);
    const slDistOpen = 5.7;
    const riskOpen = slDistOpen * 0.5 * conv;
    made.push({
      id: 'sample-open-' + uid(),
      accountType: 'demo',
      openedAt: openAt.toISOString(), createdAt: openAt.toISOString(),
      symbol: 'XAUUSD', dir: 'BUY', setup: 'Pullback EMA50',
      entry: 2665.2, sl: 2659.5, tp: 2673.8, lot: 0.5,
      slDist: slDistOpen, rr: Math.abs(2673.8 - 2665.2) / slDistOpen,
      riskCent: riskOpen, riskPct: (riskOpen / bal) * 100,
      balanceAtOpenCent: bal, convAtOpen: conv,
      checklist: { setup: true, sl: true, rr: true, risk: true, news: true, emotion: true, own: true },
      violations: [],
      status: 'open', closedAt: null, resultCent: null, resultR: null, exitPrice: null,
      rulesFollowed: null, tags: [], note: 'Data contoh (terbuka)', sample: true
    });

    state.trades = state.trades.filter((t) => !t.sample).concat(made);
    state.meta.sample = true;
    persist();
    renderAll();
    alert('Data contoh ditambahkan (' + made.length + ' trade). Hapus lewat tombol "Hapus data contoh".');
  }

  function clearSample() {
    const n = state.trades.filter((t) => t.sample).length;
    if (!n) { alert('Tidak ada data contoh.'); return; }
    if (!confirm('Hapus ' + n + ' trade contoh? Trade asli kamu tidak disentuh.')) return;
    state.trades = state.trades.filter((t) => !t.sample);
    state.meta.sample = state.trades.some((t) => t.sample);
    persist();
    renderAll();
    alert('Data contoh dihapus (' + n + ' trade).');
  }

  /* ================= render semua ================= */

  function renderAll() {
    renderHeader();
    renderHome();
    renderNew();
    renderClose();
    renderLog();
    renderSettings();
    renderBackup();
    switchView(state.view);
  }

  /* ================= init ================= */

  function init() {
    state.settings = Object.assign(clone(DEFAULT_SETTINGS), load(LS.settings, DEFAULT_SETTINGS));
    state.settings.rules = Object.assign({}, C.RULES_FIXED);
    state.settings.balances = state.settings.balances || { demo: null, live: null };
    if (!Array.isArray(state.settings.setups)) state.settings.setups = [];
    state.trades = load(LS.trades, []);
    if (!Array.isArray(state.trades)) state.trades = [];
    state.meta = Object.assign(clone(DEFAULT_META), load(LS.meta, DEFAULT_META));

    // navigasi
    for (const tab of document.querySelectorAll('.tab')) {
      tab.addEventListener('click', () => switchView(tab.dataset.view));
    }
    for (const b of document.querySelectorAll('[data-goto]')) {
      b.addEventListener('click', () => switchView(b.dataset.goto));
    }

    // form trade baru
    $('form-new').addEventListener('submit', saveNewTrade);
    $('nt-reset').addEventListener('click', resetNewForm);
    for (const id of ['nt-entry', 'nt-sl', 'nt-tp', 'nt-lot', 'nt-dir']) {
      $(id).addEventListener('input', updateNewCalc);
      $(id).addEventListener('change', updateNewCalc);
    }
    $('nt-setup-add').addEventListener('click', () => {
      const name = $('nt-setup-new').value.trim().slice(0, 40);
      if (!name) return;
      if (!state.settings.setups.includes(name)) state.settings.setups.push(name);
      persist();
      $('nt-setup-new').value = '';
      renderSetupOptions($('nt-setup'));
      $('nt-setup').value = name;
    });

    // form tutup
    $('form-close').addEventListener('submit', saveClose);
    $('cl-select').addEventListener('change', () => { renderCloseInfo(); updateCloseR(); });
    $('cl-result').addEventListener('input', updateCloseR);

    // jurnal
    $('log-filter').addEventListener('change', renderLog);

    // pengaturan
    $('form-settings').addEventListener('submit', saveSettings);
    $('st-account-type').addEventListener('change', () => {
      // tampilkan saldo milik tipe yang dipilih tanpa menyimpan dulu
      const type = $('st-account-type').value === 'live' ? 'live' : 'demo';
      $('st-balance-label').textContent = 'Saldo awal akun ' + type.toUpperCase() + ' (cent)';
      const v = state.settings.balances ? state.settings.balances[type] : null;
      $('st-balance').value = v == null ? '' : String(v);
    });
    $('st-conv').addEventListener('input', updateConvPreview);
    $('st-setup-add').addEventListener('click', () => {
      const name = $('st-setup-new').value.trim().slice(0, 40);
      if (!name) return;
      if (!state.settings.setups.includes(name)) state.settings.setups.push(name);
      persist();
      $('st-setup-new').value = '';
      renderSetupList();
      renderSetupOptions($('nt-setup'));
    });
    $('btn-sample').addEventListener('click', fillSample);
    $('btn-sample-clear').addEventListener('click', clearSample);

    // backup
    $('bk-json').addEventListener('click', exportJson);
    $('bk-csv').addEventListener('click', exportCsv);
    $('bk-import').addEventListener('click', importJson);
    $('bk-wipe').addEventListener('click', wipeAll);

    buildChecklist();
    renderAll();

    // service worker (hanya di http/https — file:// tidak mendukung)
    if ('serviceWorker' in navigator && location.protocol !== 'file:') {
      navigator.serviceWorker.register('sw.js').catch(() => { /* offline saja yang hilang */ });
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();

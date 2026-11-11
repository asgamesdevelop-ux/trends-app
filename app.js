'use strict';
// ===== справочники =====
const COUNTRIES = { us: ['🇺🇸', 'США'], ru: ['🇷🇺', 'Россия'], br: ['🇧🇷', 'Бразилия'], in: ['🇮🇳', 'Индия'], de: ['🇩🇪', 'Германия'], jp: ['🇯🇵', 'Япония'], kr: ['🇰🇷', 'Корея'], tr: ['🇹🇷', 'Турция'] };
const COLLS = { TOP_FREE: 'Бесплатные', GROSSING: 'Кассовые' };
const CATS = { GAME: 'Все игры', GAME_ACTION: 'Action', GAME_SIMULATION: 'Simulation', GAME_STRATEGY: 'Strategy' };
const FRESH_DAYS = 60;

// ===== утилиты =====
const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmt = (n) => n == null ? '—' : n >= 1e9 ? (n / 1e9).toFixed(1).replace('.0', '') + 'B' : n >= 1e6 ? (n / 1e6).toFixed(1).replace('.0', '') + 'M' : n >= 1e3 ? Math.round(n / 1e3) + 'K' : String(n);
const daysBetween = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / 864e5);
const ageText = (d) => d == null ? '—' : d <= 60 ? `${d} дн.` : d < 365 ? `${Math.round(d / 30)} мес.` : `${(d / 365).toFixed(1).replace('.0', '')} г.`;
const plural = (n, a, b, c) => { const m10 = n % 10, m100 = n % 100; return m10 === 1 && m100 !== 11 ? a : m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14) ? b : c; };
const hue = (s) => { let h = 0; for (const c of s) h = (h * 31 + c.charCodeAt(0)) % 360; return h; };
const store = {
  get(k, d) { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
};

// ===== данные =====
let H, R, DAYS, LAST, PREV;
const idIndex = new Map();

function icon(id, size = 44) {
  const a = H.apps[id] || {};
  const letter = esc((a.t || '?').trim()[0] || '?');
  const bg = `hsl(${hue(id)} 45% 32%)`;
  const img = a.icon ? `<img src="${esc(a.icon)}=w${size * 2}" alt="" loading="lazy" onerror="this.remove()">` : '';
  return `<div class="ic" style="width:${size}px;height:${size}px;background:${bg};font-size:${Math.round(size * .42)}px">${letter}${img}</div>`;
}

function info(id) {
  const a = H.apps[id] || {};
  const inst = a.inst?.[LAST] ?? null;
  const ip = PREV ? a.inst?.[PREV] ?? null : null;
  const age = a.rel ? daysBetween(a.rel, LAST) : null;
  return {
    id, title: a.t || id, dev: a.dev || '', genre: a.genre || '', score: a.score, rel: a.rel, age,
    installs: inst, daily: inst != null && ip != null ? inst - ip : null,
    perDay: inst != null && age ? Math.round(inst / Math.max(age, 1)) : null,
  };
}

function listKey(c, coll, cat) { return `${c}|${coll}|${cat}`; }

function listRows(key) {
  const byDay = H.ranks[key] || {};
  const cur = byDay[LAST] || [];
  const prev = PREV ? byDay[PREV] : null;
  const recent = DAYS.filter((d) => d < LAST && daysBetween(d, LAST) <= 7 && byDay[d]).map((d) => new Set(byDay[d]));
  return cur.map((i, r) => {
    const p = prev ? prev.indexOf(i) : -1;
    return { ...info(H.ids[i]), rank: r + 1, change: prev && p >= 0 ? p - r : null, entered: !!prev && p < 0, isNew: !!prev && p < 0 && !recent.some((s) => s.has(i)) };
  });
}

function whereInTops(id) {
  const i = idIndex.get(id); const out = [];
  for (const [key, byDay] of Object.entries(H.ranks)) {
    const cur = byDay[LAST]; if (!cur) continue;
    const r = cur.indexOf(i); if (r < 0) continue;
    const prev = PREV ? byDay[PREV] : null; const p = prev ? prev.indexOf(i) : -1;
    const [c, coll, cat] = key.split('|');
    out.push({ key, c, coll, cat, rank: r + 1, change: prev && p >= 0 ? p - r : null });
  }
  return out.sort((a, b) => a.rank - b.rank);
}

function deltaHtml(r) {
  if (r.isNew) return '<span class="nw">NEW</span>';
  if (r.entered) return '<span class="nw">вход</span>';
  if (r.change > 0) return `<span class="up">▲${r.change}</span>`;
  if (r.change < 0) return `<span class="down">▼${-r.change}</span>`;
  return '<span class="sub">·</span>';
}

function itemHtml(r, opts = {}) {
  return `<a class="item" href="#/game/${encodeURIComponent(r.id)}">
    ${opts.rank ? `<div class="rank">${r.rank}</div>${PREV ? `<div class="delta">${deltaHtml(r)}</div>` : ''}` : ''}
    ${icon(r.id, 44)}
    <div class="grow"><div class="ttl">${esc(r.title)}${opts.tag ? `<span class="tag">${esc(opts.tag)}</span>` : ''}</div>
      <div class="dev">${esc(opts.sub ?? `${r.dev}${r.genre ? ' · ' + r.genre : ''}`)}</div></div>
    <div class="num hide-sm">${fmt(r.installs)}<span class="s">установок</span></div>
    <div class="num">${opts.right ?? (r.daily != null ? `<span class="up">+${fmt(r.daily)}</span><span class="s">за сутки</span>` : `${ageText(r.age)}<span class="s">возраст</span>`)}</div>
  </a>`;
}

// ===== экраны =====
function viewHome() {
  const all = new Set(); let entered = new Map(); let climbers = [];
  for (const key of Object.keys(H.ranks)) {
    if (!H.ranks[key][LAST]) continue;
    const [c] = key.split('|');
    for (const r of listRows(key)) {
      all.add(r.id);
      if (r.isNew && !entered.has(r.id)) entered.set(r.id, { ...r, c });
      if ((r.change ?? 0) >= 5) climbers.push({ ...r, c, key });
    }
  }
  const infos = [...all].map(info);
  const fresh = infos.filter((a) => a.age != null && a.age <= FRESH_DAYS).sort((a, b) => (b.perDay || 0) - (a.perDay || 0));
  const daily = infos.filter((a) => a.daily > 0).sort((a, b) => b.daily - a.daily).slice(0, 10);
  const seen = new Set(); climbers = climbers.sort((a, b) => b.change - a.change).filter((r) => !seen.has(r.id) && seen.add(r.id)).slice(0, 10);
  const newList = [...entered.values()].sort((a, b) => a.rank - b.rank).slice(0, 10);

  return `
  <div class="top"><div><h1>Сегодня</h1><div class="sub">Google Play · 8 рынков · срез ${LAST}${PREV ? '' : ' · первый день истории'}</div></div></div>
  <div class="kpis">
    <div class="kpi"><div class="k">Игр в топах</div><div class="v">${all.size}</div><div class="d">8 стран, 4 категории</div></div>
    <div class="kpi"><div class="k">Свежих релизов</div><div class="v">${fresh.length}</div><div class="d">младше ${FRESH_DAYS} дней</div></div>
    <div class="kpi"><div class="k">Новых в топах</div><div class="v">${PREV ? entered.size : '—'}</div><div class="d">${PREV ? 'за сутки' : 'со второго дня'}</div></div>
    <div class="kpi"><div class="k">Лидер по установкам</div><div class="v">${daily[0] ? '+' + fmt(daily[0].daily) : '—'}</div><div class="d">${daily[0] ? esc(daily[0].title) : 'со второго дня'}</div></div>
  </div>

  <h2>Радар взлётов <span class="sub">свежие игры, быстрее всех набирающие установки</span></h2>
  <div class="hscroll">${fresh.slice(0, 12).map((a) => `
    <a class="rcard" href="#/game/${encodeURIComponent(a.id)}">
      <div class="row">${icon(a.id, 52)}<div class="t">${esc(a.title)}</div></div>
      <div><div class="big">~${fmt(a.perDay)}<span class="sub" style="font-weight:400;font-size:13px"> / день</span></div></div>
      <div class="meta"><span>${esc(a.genre)}</span><span>${ageText(a.age)} · ${fmt(a.installs)}</span></div>
    </a>`).join('')}</div>

  ${PREV ? `
  <div class="grid2">
    <div><h2>Больше всего установок за сутки</h2><div class="list">${daily.map((r) => itemHtml(r)).join('') || '<div class="empty">Нет данных</div>'}</div></div>
    <div><h2>Быстрее всех растут в топах</h2><div class="list">${climbers.map((r) => itemHtml(r, { sub: `${COUNTRIES[r.c][0]} ${CATS[r.key.split('|')[2]]} · #${r.rank}`, right: `<span class="up">▲${r.change}</span><span class="s">позиций</span>` })).join('') || '<div class="empty">Нет заметных взлётов</div>'}</div></div>
  </div>
  <h2>Новые в топах</h2><div class="list">${newList.map((r) => itemHtml(r, { tag: 'NEW', sub: `${COUNTRIES[r.c][0]} #${r.rank} · ${r.dev}` })).join('') || '<div class="empty">Сегодня новых нет</div>'}</div>
  ` : `<div class="panel" style="margin-top:24px"><b>История копится.</b><div class="note" style="margin-top:4px">Со второго дня здесь появятся: больше всего установок за сутки, самые быстрые взлёты в топах и новые игры в чартах.</div></div>`}
  `;
}

function viewTops() {
  const f = store.get('tops', { c: 'us', coll: 'TOP_FREE', cat: 'GAME' });
  if (f.c === 'ru') f.coll = 'TOP_FREE';
  const rows = listRows(listKey(f.c, f.coll, f.cat));
  const chips = (obj, k, dis = () => false) => Object.entries(obj).map(([v, l]) => `<button class="chip ${f[k] === v ? 'on' : ''}" data-f="${k}" data-v="${v}" ${dis(v) ? 'disabled' : ''}>${Array.isArray(l) ? l.join(' ') : l}</button>`).join('');
  setTimeout(() => document.querySelectorAll('[data-f]').forEach((b) => b.onclick = () => { f[b.dataset.f] = b.dataset.v; store.set('tops', f); render(); }));
  return `
  <div class="top"><div><h1>Топы</h1><div class="sub">${COUNTRIES[f.c].join(' ')} · ${COLLS[f.coll]} · ${CATS[f.cat]}</div></div></div>
  <div class="chips">${chips(COUNTRIES, 'c')}</div>
  <div class="chips">${chips(COLLS, 'coll', (v) => f.c === 'ru' && v === 'GROSSING')}<span style="width:8px"></span>${chips(CATS, 'cat')}</div>
  <div class="list">${rows.map((r) => itemHtml(r, { rank: true })).join('') || '<div class="empty">Нет данных для этого списка</div>'}</div>
  ${f.c === 'ru' ? '<div class="note">Кассовых топов по России нет: оплата через Google Play в РФ отключена.</div>' : ''}`;
}

function viewRadar() {
  const lim = store.get('radarDays', 60);
  const ids = new Set(); for (const byDay of Object.values(H.ranks)) for (const i of byDay[LAST] || []) ids.add(H.ids[i]);
  const fresh = [...ids].map(info).filter((a) => a.age != null && a.age <= lim).sort((a, b) => (b.perDay || 0) - (a.perDay || 0));
  setTimeout(() => document.querySelectorAll('[data-lim]').forEach((b) => b.onclick = () => { store.set('radarDays', +b.dataset.lim); render(); }));
  return `
  <div class="top"><div><h1>Радар взлётов</h1><div class="sub">Свежие релизы из топов, по средним установкам в день с момента выхода</div></div></div>
  <div class="chips">${[14, 30, 60].map((d) => `<button class="chip ${lim === d ? 'on' : ''}" data-lim="${d}">до ${d} дней</button>`).join('')}</div>
  <div class="list">${fresh.map((a, i) => itemHtml({ ...a, rank: i + 1 }, { sub: `${a.dev} · ${a.genre} · ${ageText(a.age)}`, right: `<b class="up">~${fmt(a.perDay)}</b><span class="s">в день</span>` })).join('') || '<div class="empty">Нет свежих игр в топах</div>'}</div>`;
}

function viewFav() {
  const fav = store.get('fav', []).filter((id) => H.apps[id]);
  return `
  <div class="top"><div><h1>Избранное</h1><div class="sub">Игры, за которыми ты следишь</div></div></div>
  ${fav.length ? `<div class="list">${fav.map((id) => itemHtml(info(id))).join('')}</div>` : '<div class="panel empty">Пока пусто. Открой любую игру и нажми ☆, чтобы следить за ней.</div>'}`;
}

let charts = [];
function viewGame(id) {
  const a = info(id); const raw = H.apps[id];
  if (!raw) return '<div class="empty">Игра не найдена</div>';
  const where = whereInTops(id);
  const fav = store.get('fav', []); const isFav = fav.includes(id);
  const sel = where[0]?.key;
  setTimeout(() => {
    $('#favbtn').onclick = () => { const f = store.get('fav', []); store.set('fav', isFav ? f.filter((x) => x !== id) : [...f, id]); render(); };
    document.querySelectorAll('[data-key]').forEach((b) => b.onclick = () => { document.querySelectorAll('[data-key]').forEach((x) => x.classList.toggle('on', x === b)); drawRank(id, b.dataset.key); });
    if (sel) drawRank(id, sel); drawInstalls(id);
  });
  return `
  <a class="back" href="javascript:history.back()">← Назад</a>
  <div class="ghead">${icon(id, 80)}<div class="grow"><h1>${esc(a.title)}</h1><div class="dev">${esc(a.dev)}</div>
    <div class="pills">${a.genre ? `<span class="pill">${esc(a.genre)}</span>` : ''}${a.score ? `<span class="pill">★ ${a.score.toFixed(1)}</span>` : ''}${a.rel ? `<span class="pill">Релиз ${a.rel}</span>` : ''}</div></div></div>
  <div class="actions">
    <a class="btn pri" href="https://play.google.com/store/apps/details?id=${encodeURIComponent(id)}" target="_blank" rel="noopener">Открыть в Google Play</a>
    <button class="btn" id="favbtn">${isFav ? '★ В избранном' : '☆ Следить'}</button>
  </div>
  <div class="kpis" style="margin-top:18px">
    <div class="kpi"><div class="k">Установки</div><div class="v">${fmt(a.installs)}</div></div>
    <div class="kpi"><div class="k">За сутки</div><div class="v ${a.daily > 0 ? 'up' : ''}">${a.daily != null ? '+' + fmt(a.daily) : '—'}</div></div>
    <div class="kpi"><div class="k">В день с релиза</div><div class="v">${a.perDay ? '~' + fmt(a.perDay) : '—'}</div></div>
    <div class="kpi"><div class="k">Возраст</div><div class="v">${ageText(a.age)}</div></div>
  </div>
  <h2>Позиции в топах <span class="sub">в ${where.length} ${plural(where.length, 'списке', 'списках', 'списках')}</span></h2>
  ${where.length ? `<div class="where">${where.map((w, i) => `<button data-key="${w.key}" class="${i === 0 ? 'on' : ''}">${COUNTRIES[w.c][0]} ${w.coll === 'GROSSING' ? '💰 ' : ''}${CATS[w.cat]} <b>#${w.rank}</b> ${w.change > 0 ? `<span class="up">▲${w.change}</span>` : w.change < 0 ? `<span class="down">▼${-w.change}</span>` : ''}</button>`).join('')}</div>` : '<div class="note">Сегодня в отслеживаемых топах не появлялась.</div>'}
  <div class="grid2" style="margin-top:12px">
    <div class="panel"><div class="sub" id="rankTitle">История позиции</div><div class="chartbox"><canvas id="cRank"></canvas></div></div>
    <div class="panel"><div class="sub">Установки, всего</div><div class="chartbox"><canvas id="cInst"></canvas></div></div>
  </div>
  ${DAYS.length < 3 ? '<div class="note">Графики наполняются по мере накопления ежедневной истории.</div>' : ''}`;
}

const chartBase = () => ({
  responsive: true, maintainAspectRatio: false, animation: false,
  interaction: { mode: 'index', intersect: false },
  plugins: { legend: { display: false }, tooltip: { backgroundColor: '#0b0d12', borderColor: '#242a37', borderWidth: 1, padding: 10 } },
  scales: { x: { grid: { color: '#1c2130' }, ticks: { color: '#8a92a6', maxTicksLimit: 6 } }, y: { grid: { color: '#1c2130' }, ticks: { color: '#8a92a6' } } },
});

function drawRank(id, key) {
  const [c, coll, cat] = key.split('|');
  $('#rankTitle').textContent = `История позиции: ${COUNTRIES[c][0]} ${COLLS[coll]} · ${CATS[cat]}`;
  const i = idIndex.get(id); const byDay = H.ranks[key] || {};
  const pts = DAYS.map((d) => { const l = byDay[d]; const p = l ? l.indexOf(i) : -1; return p >= 0 ? p + 1 : null; });
  charts[0]?.destroy();
  const o = chartBase(); o.scales.y.reverse = true; o.scales.y.min = 1; o.scales.y.suggestedMax = 50; o.scales.y.ticks.callback = (v) => '#' + v;
  o.plugins.tooltip.callbacks = { label: (ctx) => ctx.raw == null ? 'вне топа' : ` #${ctx.raw}` };
  charts[0] = new Chart($('#cRank'), { type: 'line', data: { labels: DAYS.map((d) => d.slice(5)), datasets: [{ data: pts, borderColor: '#3ddc97', backgroundColor: '#3ddc97', pointRadius: DAYS.length < 15 ? 4 : 0, tension: .25, spanGaps: false }] }, options: o });
}
function drawInstalls(id) {
  const a = H.apps[id]; const pts = DAYS.map((d) => a.inst?.[d] ?? null);
  charts[1]?.destroy();
  const o = chartBase(); o.scales.y.ticks.callback = (v) => fmt(v);
  o.plugins.tooltip.callbacks = { label: (ctx) => ` ${fmt(ctx.raw)} установок` };
  charts[1] = new Chart($('#cInst'), { type: 'line', data: { labels: DAYS.map((d) => d.slice(5)), datasets: [{ data: pts, borderColor: '#5b8cff', backgroundColor: 'rgba(91,140,255,.15)', fill: true, pointRadius: DAYS.length < 15 ? 4 : 0, tension: .25 }] }, options: o });
}

// ===== роутер =====
function render() {
  charts.forEach((c) => c?.destroy()); charts = [];
  const h = location.hash.replace(/^#\/?/, '');
  const [route, arg] = h.split('/');
  const r = route || 'home';
  document.querySelectorAll('#nav a').forEach((a) => a.classList.toggle('on', a.dataset.r === (r === 'game' ? '' : r)));
  const html = r === 'tops' ? viewTops() : r === 'radar' ? viewRadar() : r === 'fav' ? viewFav() : r === 'game' ? viewGame(decodeURIComponent(arg || '')) : viewHome();
  $('#view').innerHTML = html;
  if (r !== 'game') window.scrollTo(0, 0);
}
addEventListener('hashchange', render);

Promise.all([fetch('data/history.json', { cache: 'no-cache' }).then((r) => r.json())]).then(([h]) => {
  H = h; DAYS = [...H.days].sort(); LAST = DAYS.at(-1); PREV = DAYS.at(-2) || null;
  H.ids.forEach((id, i) => idIndex.set(id, i));
  Chart.defaults.font.family = getComputedStyle(document.body).fontFamily;
  render();
}).catch((e) => { $('#view').innerHTML = `<div class="empty">Не удалось загрузить данные: ${esc(e.message)}</div>`; });

if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});

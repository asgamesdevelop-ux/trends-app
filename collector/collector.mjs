// Сборщик топов Google Play для дашборда трендов.
// Запуск: node collector.mjs <папка_с_данными>
// Читает <папка>/history.json (если есть), дописывает сегодняшний срез,
// пишет history.json, report.json и summary.md.
import gplay from 'google-play-scraper';
import fs from 'node:fs';
import path from 'node:path';

const DIR = process.argv[2] || './data';
fs.mkdirSync(DIR, { recursive: true });

const CONFIG = {
  countries: { us: 'en', ru: 'ru', br: 'pt', in: 'en', de: 'en', jp: 'en', kr: 'en', tr: 'en' },
  collections: ['TOP_FREE', 'GROSSING'],
  categories: ['GAME', 'GAME_ACTION', 'GAME_SIMULATION', 'GAME_STRATEGY'],
  num: 50,
  keepDays: 60,
  freshDays: 60,
};
const COLL = { TOP_FREE: gplay.collection.TOP_FREE, GROSSING: gplay.collection.GROSSING };

const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Istanbul' }).format(new Date());
const dayMs = 86400000;
const daysBetween = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / dayMs);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function retry(fn, tries = 3) {
  let err;
  for (let i = 0; i < tries; i++) {
    try { return await fn(); } catch (e) { err = e; await sleep(1500 * (i + 1)); }
  }
  throw err;
}

async function pool(items, n, fn) {
  const out = []; let i = 0;
  await Promise.all(Array.from({ length: n }, async () => {
    while (i < items.length) { const k = i++; out[k] = await fn(items[k], k); }
  }));
  return out;
}

// ---------- 1. загрузка истории ----------
const histPath = path.join(DIR, 'history.json');
let H = fs.existsSync(histPath)
  ? JSON.parse(fs.readFileSync(histPath, 'utf8'))
  : { version: 1, days: [], ids: [], apps: {}, ranks: {} };
const idIndex = new Map(H.ids.map((id, i) => [id, i]));
const idx = (id) => { if (!idIndex.has(id)) { idIndex.set(id, H.ids.length); H.ids.push(id); } return idIndex.get(id); };

// ---------- 2. топ-чарты ----------
const lists = {}; // key -> [{id,title,developer,icon}]
const errors = [];
const jobs = [];
for (const [c, lang] of Object.entries(CONFIG.countries))
  for (const coll of CONFIG.collections)
    for (const cat of CONFIG.categories) {
      if (c === 'ru' && coll === 'GROSSING') continue; // в РФ кассовых топов нет (платежи Google Play отключены)
      jobs.push({ c, lang, coll, cat });
    }

await pool(jobs, 3, async ({ c, lang, coll, cat }) => {
  const key = `${c}|${coll}|${cat}`;
  try {
    const r = await retry(() => gplay.list({
      collection: COLL[coll], category: gplay.category[cat], country: c, lang, num: CONFIG.num, fullDetail: false,
    }));
    lists[key] = r.map((x) => ({ id: x.appId, title: x.title, developer: x.developer, icon: x.icon, c }));
  } catch (e) { errors.push(`${key}: ${e.message}`); }
});

// ---------- 3. детали приложений (установки, дата релиза) ----------
const firstSeen = new Map();
for (const arr of Object.values(lists)) for (const a of arr) if (!firstSeen.has(a.id)) firstSeen.set(a.id, a);
const uniq = [...firstSeen.keys()];

await pool(uniq, 6, async (id) => {
  const seen = firstSeen.get(id);
  const prev = H.apps[id] || {};
  const rec = { ...prev, t: prev.t || seen.title, dev: seen.developer, icon: seen.icon || prev.icon, inst: prev.inst || {} };
  try {
    const d = await retry(() => gplay.app({ appId: id, country: seen.c, lang: 'en' }), 2);
    if (d.released) { const p = Date.parse(d.released); if (!isNaN(p)) rec.rel = new Date(p).toISOString().slice(0, 10); }
    rec.genre = d.genre; rec.score = d.score ? +d.score.toFixed(2) : null;
    rec.inst[today] = d.maxInstalls ?? d.minInstalls ?? null;
    rec.upd = d.updated ? new Date(d.updated).toISOString().slice(0, 10) : rec.upd;
  } catch (e) { /* приложение могло быть недоступно — оставляем что было */ }
  H.apps[id] = rec;
});

// ---------- 4. запись среза ----------
if (!H.days.includes(today)) H.days.push(today);
H.days.sort();
for (const [key, arr] of Object.entries(lists)) {
  H.ranks[key] = H.ranks[key] || {};
  H.ranks[key][today] = arr.map((a) => idx(a.id));
}
// обрезка старых дней
const cutoff = new Date(Date.parse(today) - CONFIG.keepDays * dayMs).toISOString().slice(0, 10);
H.days = H.days.filter((d) => d >= cutoff);
for (const k of Object.keys(H.ranks)) for (const d of Object.keys(H.ranks[k])) if (d < cutoff) delete H.ranks[k][d];
for (const [id, a] of Object.entries(H.apps)) {
  for (const d of Object.keys(a.inst || {})) if (d < cutoff) delete a.inst[d];
  if (!Object.keys(a.inst || {}).length && !uniq.includes(id)) delete H.apps[id];
}
H.updated = new Date().toISOString();
H.config = CONFIG;

// ---------- 5. анализ ----------
const prevDay = [...H.days].filter((d) => d < today).pop() || null;
const weekDay = [...H.days].filter((d) => d <= new Date(Date.parse(today) - 7 * dayMs).toISOString().slice(0, 10)).pop() || null;
const appInfo = (id) => {
  const a = H.apps[id] || {};
  const age = a.rel ? daysBetween(a.rel, today) : null;
  const inst = a.inst?.[today] ?? null;
  const instPrev = prevDay ? a.inst?.[prevDay] ?? null : null;
  return {
    id, title: a.t, dev: a.dev, genre: a.genre, released: a.rel || null, ageDays: age, installs: inst,
    dailyInstalls: inst != null && instPrev != null ? inst - instPrev : null,
    perDaySinceRelease: inst != null && age ? Math.round(inst / Math.max(age, 1)) : null,
  };
};

const report = { date: today, prevDay, weekDay, errors, lists: {}, fresh: [], topDaily: [] };
for (const [key, byDay] of Object.entries(H.ranks)) {
  const cur = byDay[today]; if (!cur) continue;
  const prev = prevDay ? byDay[prevDay] : null;
  const week = weekDay ? byDay[weekDay] : null;
  const recent = Object.entries(byDay).filter(([d]) => d < today && daysBetween(d, today) <= 7).map(([, v]) => new Set(v));
  const rows = cur.map((i, r) => {
    const id = H.ids[i];
    const pr = prev ? prev.indexOf(i) : -1;
    const wr = week ? week.indexOf(i) : -1;
    return {
      id, rank: r + 1,
      prevRank: prev ? (pr >= 0 ? pr + 1 : null) : undefined,
      change: prev && pr >= 0 ? pr - r : null,
      weekChange: week && wr >= 0 ? wr - r : null,
      isNew: prev ? pr < 0 && !recent.some((s) => s.has(i)) : false,
      entered: prev ? pr < 0 : false,
    };
  });
  report.lists[key] = {
    newEntries: rows.filter((x) => x.entered).map((x) => ({ ...x, ...appInfo(x.id) })),
    climbers: rows.filter((x) => (x.change ?? 0) >= 5).sort((a, b) => b.change - a.change).slice(0, 10).map((x) => ({ ...x, ...appInfo(x.id) })),
  };
}
const inTop = new Set(Object.values(lists).flat().map((a) => a.id));
const allInfo = [...inTop].map(appInfo);
report.fresh = allInfo.filter((a) => a.ageDays != null && a.ageDays <= CONFIG.freshDays)
  .sort((a, b) => (b.perDaySinceRelease || 0) - (a.perDaySinceRelease || 0)).slice(0, 25);
report.topDaily = allInfo.filter((a) => a.dailyInstalls != null && a.dailyInstalls > 0)
  .sort((a, b) => b.dailyInstalls - a.dailyInstalls).slice(0, 25);

// ---------- 6. текстовая сводка ----------
const CN = { us: '🇺🇸 США', ru: '🇷🇺 Россия', br: '🇧🇷 Бразилия', in: '🇮🇳 Индия', de: '🇩🇪 Германия', jp: '🇯🇵 Япония', kr: '🇰🇷 Корея', tr: '🇹🇷 Турция' };
const CAT = { GAME: 'Все игры', GAME_ACTION: 'Action', GAME_SIMULATION: 'Simulation', GAME_STRATEGY: 'Strategy' };
const fmt = (n) => n == null ? '—' : n >= 1e9 ? (n / 1e9).toFixed(1).replace('.0', '') + 'B' : n >= 1e6 ? (n / 1e6).toFixed(1).replace('.0', '') + 'M' : n >= 1e3 ? Math.round(n / 1e3) + 'K' : String(n);
let md = `# Тренды Google Play — ${today}\n\n`;
if (!prevDay) md += '_Первый срез: сравнения с прошлыми днями появятся со второго запуска._\n\n';
md += `## Свежие релизы, которые быстро набирают (≤${CONFIG.freshDays} дней)\n`;
for (const a of report.fresh.slice(0, 8)) md += `- **${a.title}** (${a.dev}) — ${fmt(a.installs)} установок за ${a.ageDays} дн., ~${fmt(a.perDaySinceRelease)}/день, ${a.genre || ''}\n`;
if (prevDay) {
  md += `\n## Больше всего установок за сутки\n`;
  for (const a of report.topDaily.slice(0, 8)) md += `- **${a.title}** — +${fmt(a.dailyInstalls)}\n`;
  md += `\n## Новые в топах и самые быстрые взлёты\n`;
  for (const c of Object.keys(CONFIG.countries)) {
    const parts = [];
    for (const cat of CONFIG.categories) {
      const L = report.lists[`${c}|TOP_FREE|${cat}`]; if (!L) continue;
      const nn = L.newEntries.filter((x) => x.isNew).slice(0, 3).map((x) => `${x.title} (#${x.rank}, новинка)`);
      const cl = L.climbers.slice(0, 2).map((x) => `${x.title} (↑${x.change} → #${x.rank})`);
      if (nn.length || cl.length) parts.push(`  - ${CAT[cat]}: ${[...nn, ...cl].join('; ')}`);
    }
    if (parts.length) md += `- ${CN[c]}\n${parts.join('\n')}\n`;
  }
}
if (errors.length) md += `\n_Не удалось загрузить: ${errors.length} списков._\n`;

fs.writeFileSync(histPath, JSON.stringify(H));
fs.writeFileSync(path.join(DIR, 'report.json'), JSON.stringify(report));
fs.writeFileSync(path.join(DIR, 'summary.md'), md);
console.log(md);
console.log(`\n[lists ${Object.keys(lists).length}/${jobs.length}, apps ${uniq.length}, history ${(fs.statSync(histPath).size / 1024).toFixed(0)} KB]`);

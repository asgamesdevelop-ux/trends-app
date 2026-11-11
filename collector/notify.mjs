// Утренняя сводка в Telegram по data/report.json.
// Чат находится автоматически: достаточно один раз написать боту /start.
import fs from 'node:fs';
import path from 'node:path';

const DIR = process.argv[2] || '../data';
const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const APP_URL = process.env.APP_URL || '';
if (!TOKEN) { console.log('TELEGRAM_BOT_TOKEN не задан — сводка пропущена'); process.exit(0); }

const api = async (method, body) => {
  const r = await fetch(`https://api.telegram.org/bot${TOKEN}/${method}`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body || {}),
  });
  return r.json();
};

// чаты: сохранённые + новые из getUpdates (кто написал боту)
const chatsPath = path.join(DIR, 'telegram_chats.json');
const chats = new Set(fs.existsSync(chatsPath) ? JSON.parse(fs.readFileSync(chatsPath, 'utf8')) : []);
const me = await api('getMe');
if (!me.ok) { console.log('Токен не принят Telegram:', me.description, '— проверь секрет TELEGRAM_BOT_TOKEN'); process.exit(1); }
console.log('Бот:', '@' + me.result.username);
const hook = await api('getWebhookInfo');
if (hook.result?.url) { await api('deleteWebhook'); console.log('Снят webhook'); }
const upd = await api('getUpdates', { limit: 100 });
if (!upd.ok) console.log('getUpdates:', upd.description);
console.log('Новых сообщений боту:', (upd.result || []).length);
for (const u of upd.result || []) { const id = u.message?.chat?.id ?? u.my_chat_member?.chat?.id; if (id) chats.add(id); }
fs.writeFileSync(chatsPath, JSON.stringify([...chats]));
if (!chats.size) { console.log('Нет чатов: напиши боту /start и запусти ещё раз'); process.exit(0); }

const R = JSON.parse(fs.readFileSync(path.join(DIR, 'report.json'), 'utf8'));
const esc = (s) => String(s ?? '').replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
const fmt = (n) => n == null ? '—' : n >= 1e9 ? (n / 1e9).toFixed(1).replace('.0', '') + 'B' : n >= 1e6 ? (n / 1e6).toFixed(1).replace('.0', '') + 'M' : n >= 1e3 ? Math.round(n / 1e3) + 'K' : String(n);
const FL = { us: '🇺🇸', ru: '🇷🇺', br: '🇧🇷', in: '🇮🇳', de: '🇩🇪', jp: '🇯🇵', kr: '🇰🇷', tr: '🇹🇷' };
const CAT = { GAME: 'Игры', GAME_ACTION: 'Action', GAME_SIMULATION: 'Simulation', GAME_STRATEGY: 'Strategy' };

let t = `<b>📈 Тренды Google Play — ${R.date}</b>\n`;
if (!R.prevDay) t += `<i>Первый срез — сравнения появятся завтра.</i>\n`;
t += `\n<b>🚀 Радар взлётов</b> (свежие игры, установок в день)\n`;
for (const a of R.fresh.slice(0, 6)) t += `• ${esc(a.title)} — ~${fmt(a.perDaySinceRelease)}/день, ${a.ageDays} дн., ${esc(a.genre || '')}\n`;
if (R.prevDay && R.topDaily.length) {
  t += `\n<b>⬆️ Больше всего установок за сутки</b>\n`;
  for (const a of R.topDaily.slice(0, 5)) t += `• ${esc(a.title)} — +${fmt(a.dailyInstalls)}\n`;
}
if (R.prevDay) {
  const items = [];
  for (const [key, L] of Object.entries(R.lists)) {
    const [c, coll, cat] = key.split('|'); if (coll !== 'TOP_FREE') continue;
    for (const x of L.newEntries.filter((x) => x.isNew && x.rank <= 30)) items.push({ s: 100 - x.rank, txt: `${FL[c]} ${esc(x.title)} — новинка, #${x.rank} в ${CAT[cat]}` });
    for (const x of L.climbers.slice(0, 2)) items.push({ s: x.change, txt: `${FL[c]} ${esc(x.title)} — ↑${x.change} → #${x.rank} в ${CAT[cat]}` });
  }
  const seen = new Set(); const top = items.sort((a, b) => b.s - a.s).filter((i) => !seen.has(i.txt) && seen.add(i.txt)).slice(0, 8);
  if (top.length) { t += `\n<b>🆕 Новинки и взлёты в топах</b>\n`; for (const i of top) t += `• ${i.txt}\n`; }
}
if (APP_URL) t += `\n<a href="${APP_URL}">Открыть приложение →</a>`;
if (t.length > 4000) t = t.slice(0, 3990) + '…';

for (const chat_id of chats) {
  const r = await api('sendMessage', { chat_id, text: t, parse_mode: 'HTML', disable_web_page_preview: true });
  console.log(chat_id, r.ok ? 'отправлено' : r.description);
}

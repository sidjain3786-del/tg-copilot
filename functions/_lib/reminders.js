// ⏰ Auto reminders: messages the admin sets for morning / evening / night, sent as phone
// notifications automatically. A Cloudflare Worker (or any cron service) calls /api/cron/tick
// every few minutes; the tick sends whatever is due in Indian time, once per day per slot.
import { parseColumn } from './auth.js';

export const DEFAULT_REMINDERS = {
  enabled: false,
  slots: [
    { id: 'morning', on: true, time: '08:45', days: [1, 2, 3, 4, 5], target: 'all', tab: 'copilot', title: '☀️ Good morning, traders!',
      messages: 'Aaj ka plan likho, setup ka wait karo. Have a profitable day, {name}!\nMarket khulne se pehle: risk fix karo, rules yaad karo — phir trade.\nPlan the trade, trade the plan. All the best, {name}!' },
    { id: 'evening', on: true, time: '15:45', days: [1, 2, 3, 4, 5], target: 'notJournaled', tab: 'log', title: "📝 Don't forget to journal",
      messages: 'Market band. Aaj ke trades abhi log karo — yaad taaza hai, screenshot bhi daalo.\n2 minute nikaalo, aaj ke trades journal karo. Kal ka aap shukriya kahega.' },
    { id: 'night', on: true, time: '21:30', days: [1, 2, 3, 4, 5], target: 'all', tab: 'notes', title: '🌙 Din ka summary',
      messages: "Sone se pehle aaj ka summary likho — kya sahi kiya, kya galat? Kal behtar trade karoge.\nAaj ki ek seekh Notes mein likh do, {name}. Wahi aapka edge banega.\nDon't forget to summarise today's trades. Good night, {name}!" }
  ]
};
export const TABS = { copilot: '/#copilot', log: '/#log', notes: '/#notes', history: '/#history', analysis: '/#analysis', challenge: '/#challenge', competition: '/#competition', blog: '/#blog' };
const clip = (v, n) => String(v ?? '').slice(0, n);

export function cleanSlots(slots) {
  return (Array.isArray(slots) ? slots : []).slice(0, 6).map((s, i) => ({
    id: /^[a-z0-9-]{1,20}$/.test(String(s?.id || '')) ? s.id : `slot-${i + 1}`,
    on: s?.on !== false,
    time: /^([01]\d|2[0-3]):[0-5]\d$/.test(String(s?.time || '')) ? s.time : '09:00',
    days: [...new Set((Array.isArray(s?.days) ? s.days : [1, 2, 3, 4, 5]).map(Number).filter(d => d >= 0 && d <= 6))].sort(),
    target: s?.target === 'notJournaled' ? 'notJournaled' : 'all',
    tab: TABS[s?.tab] ? s.tab : 'copilot',
    title: clip(s?.title, 60).trim() || 'Trader Co-Pilot',
    messages: clip(s?.messages, 1200)
  })).filter(s => s.messages.trim());
}
export async function getSetting(env, key, fallback) {
  const row = await env.DB.prepare('SELECT value FROM app_settings WHERE key = ?').bind(key).first();
  try { return row ? JSON.parse(row.value) : fallback; } catch { return fallback; }
}
export async function putSetting(env, key, value) {
  await env.DB.prepare('INSERT INTO app_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').bind(key, JSON.stringify(value)).run();
}
export async function getReminders(env) {
  const r = await getSetting(env, 'reminders', null);
  return r ? { enabled: !!r.enabled, slots: cleanSlots(r.slots) } : structuredClone(DEFAULT_REMINDERS);
}
// Indian time pieces for "now"
export function istNow(now = new Date()) {
  const x = new Date(now.getTime() + 5.5 * 3600000);
  const date = x.toISOString().slice(0, 10);
  return { date, minutes: x.getUTCHours() * 60 + x.getUTCMinutes(), weekday: x.getUTCDay(), dayStartUtc: new Date(`${date}T00:00:00+05:30`).toISOString(), dayNumber: Math.floor(x.getTime() / 86400000) };
}
const mins = t => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
export const WINDOW_MIN = 90;   // a slot missed by the cron is still sent up to 90 minutes late, never later
export function dueSlot(rem, state, now = new Date()) {
  if (!rem.enabled) return null;
  const t = istNow(now);
  return rem.slots.filter(s => s.on && s.days.includes(t.weekday) && t.minutes >= mins(s.time) && t.minutes < mins(s.time) + WINDOW_MIN && state.sent?.[s.id] !== t.date)
    .sort((a, b) => mins(a.time) - mins(b.time))[0] || null;
}
export function tradesOn(trades, dayStartUtc) {
  const start = Date.parse(dayStartUtc), end = start + 86400000;
  return (Array.isArray(trades) ? trades : []).filter(x => { const d = Date.parse(x?.date || ''); return d >= start && d < end; }).length;
}
// the text one trader sees (lines rotate day by day; {name} and {trades} are filled in)
export function messageFor(slot, user, tradesToday, dayNumber) {
  const lines = String(slot.messages || '').split('\n').map(s => s.trim()).filter(Boolean);
  const line = lines.length ? lines[((dayNumber % lines.length) + lines.length) % lines.length] : '';
  const first = String(user?.name || '').trim().split(/\s+/)[0] || 'Trader';
  const fill = s => s.replace(/\{name\}/gi, first).replace(/\{trades\}/gi, String(tradesToday ?? 0));
  return { title: fill(slot.title), body: fill(line), url: TABS[slot.tab] || '/', tag: `reminder-${slot.id}` };
}
// devices that should get this slot today
export async function recipients(env, slot, t, onlyUserId) {
  const { results } = await env.DB.prepare(`SELECT s.endpoint, s.user_id, d.trades FROM push_subscriptions s LEFT JOIN user_prefs p ON p.user_id = s.user_id LEFT JOIN user_data d ON d.user_id = s.user_id
    WHERE COALESCE(p.reminders_off, 0) = 0 ${onlyUserId ? 'AND s.user_id = ?' : ''} ORDER BY s.created_at, s.endpoint`).bind(...(onlyUserId ? [onlyUserId] : [])).all();
  return (results || []).filter(r => slot.target !== 'notJournaled' || tradesOn(parseColumn(r.trades || '[]', []), t.dayStartUtc) === 0).map(r => r.endpoint);
}

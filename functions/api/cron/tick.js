import { json, ensureSchema, getUserFromRequest, isAdminUser } from '../../_lib/auth.js';
import { getVapidKeys, sendTickle } from '../../_lib/push.js';
import { setLastPush } from '../../_lib/settings.js';
import { getReminders, getSetting, putSetting, dueSlot, istNow, recipients } from '../../_lib/reminders.js';

// GET/POST /api/cron/tick  — called every 5 minutes by the reminder Worker (header X-Cron-Key or ?key=)
// Sends a due reminder in batches of 40 devices; answers { more: true } while devices are left.
const BATCH = 40;
async function handle(request, env) {
  if (new URL(request.url).searchParams.get('check')) return json({ ok: true, check: true, secretSet: !!env.CRON_SECRET });   // System check: file is deployed, nothing is sent
  const key = request.headers.get('X-Cron-Key') || new URL(request.url).searchParams.get('key') || '';
  let allowed = !!env.CRON_SECRET && key === env.CRON_SECRET;
  if (!allowed) { const u = await getUserFromRequest(request, env); allowed = !!u && isAdminUser(u, env); }
  if (!allowed) return json({ error: env.CRON_SECRET ? 'Galat key.' : 'CRON_SECRET set nahi hai.' }, { status: 401 });
  await ensureSchema(env);
  const now = new Date(), t = istNow(now);
  const rem = await getReminders(env), state = await getSetting(env, 'reminders_state', {});
  state.sent = state.sent || {}; state.lastTick = now.toISOString();
  let slot = null, offset = 0;
  if (state.run && state.run.date === t.date) { slot = rem.slots.find(s => s.id === state.run.slot) || null; offset = state.run.offset || 0; }
  if (!slot) {
    state.run = null; slot = dueSlot(rem, state, now);
    if (!slot) { await putSetting(env, 'reminders_state', state); return json({ ok: true, sent: 0, more: false, idle: true, ist: `${t.date} ${String(Math.floor(t.minutes / 60)).padStart(2, '0')}:${String(t.minutes % 60).padStart(2, '0')}` }); }
    state.run = { slot: slot.id, date: t.date, offset: 0, sent: 0 };
    await setLastPush(env, { kind: 'reminder', slot: slot.id, date: t.date, at: now.toISOString() });
  }
  const all = await recipients(env, slot, t), batch = all.slice(offset, offset + BATCH);
  const keys = await getVapidKeys(env), subject = `mailto:${String(env.ADMIN_EMAILS || 'admin@example.com').split(',')[0].trim()}`;
  let sent = 0, gone = 0, failed = 0;
  for (const endpoint of batch) {
    const r = await sendTickle(endpoint, keys, subject);
    if (r === 'ok') { sent++; await env.DB.prepare('UPDATE push_subscriptions SET last_ok_at = ?, fails = 0 WHERE endpoint = ?').bind(now.toISOString(), endpoint).run(); }
    else if (r === 'gone') { gone++; await env.DB.prepare('DELETE FROM push_subscriptions WHERE endpoint = ?').bind(endpoint).run(); }
    else { failed++; await env.DB.prepare('UPDATE push_subscriptions SET fails = fails + 1 WHERE endpoint = ?').bind(endpoint).run(); }
  }
  const more = offset + batch.length < all.length;
  state.run.sent = (state.run.sent || 0) + sent;
  if (more) state.run.offset = offset + batch.length - gone;
  else { state.sent[slot.id] = t.date; state.lastRun = { slot: slot.id, title: slot.title, date: t.date, at: now.toISOString(), sent: state.run.sent, devices: all.length }; state.run = null; }
  await putSetting(env, 'reminders_state', state);
  return json({ ok: true, slot: slot.id, sent, gone, failed, more });
}
export const onRequestGet = ({ request, env }) => handle(request, env).catch(e => { console.error('tick', e); return json({ error: 'tick failed' }, { status: 500 }); });
export const onRequestPost = onRequestGet;

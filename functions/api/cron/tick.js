import { json, ensureSchema, getUserFromRequest, isAdminUser } from '../../_lib/auth.js';
import { getVapidKeys, sendTickle } from '../../_lib/push.js';
import { setLastPush } from '../../_lib/settings.js';
import { getReminders, getSetting, putSetting, dueSlot, istNow, recipients, mins, WINDOW_MIN } from '../../_lib/reminders.js';
import { parseColumn } from '../../_lib/auth.js';
import { progress, rowToChallenge } from '../../_lib/challenge.js';
import { sendPersonal } from '../../_lib/notify.js';

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
    if (!slot) { const nudged = await challengeNudges(env, rem, state, now); if (nudged) { await putSetting(env, 'reminders_state', state); return json({ ok: true, nudge: true, ...nudged }); }
      await putSetting(env, 'reminders_state', state); return json({ ok: true, sent: 0, more: false, idle: true, ist: `${t.date} ${String(Math.floor(t.minutes / 60)).padStart(2, '0')}:${String(t.minutes % 60).padStart(2, '0')}` }); }
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

// 💯 once a day (default 7 pm): a personal push to traders whose challenge needs them —
// a review is due, or no challenge trade for 3+ days. 15 traders per tick; the next tick continues.
async function challengeNudges(env, rem, state, now) {
  const t = istNow(now), n = rem.nudge || {};
  if (!rem.enabled || n.on === false || state.nudged === t.date) return null;
  if (!(t.minutes >= mins(n.time || '19:00') && t.minutes < mins(n.time || '19:00') + WINDOW_MIN)) return null;
  const done = state.nudgeRun?.date === t.date ? new Set(state.nudgeRun.ids || []) : new Set();
  const { results } = await env.DB.prepare(`SELECT c.*, u.name, d.trades FROM trade_challenges c JOIN users u ON u.id = c.user_id LEFT JOIN user_data d ON d.user_id = c.user_id WHERE c.status = 'active'`).all();
  let users = 0, sent = 0;
  for (const r of results || []) {
    if (done.has(r.user_id)) continue;
    if (users >= 15) { state.nudgeRun = { date: t.date, ids: [...done] }; return { users, sent, more: true }; }
    done.add(r.user_id); users++;
    const ch = rowToChallenge(r), p = progress(ch, parseColumn(r.trades || '[]', [])), first = String(r.name || '').split(/\s+/)[0] || 'Trader';
    const last = Date.parse(p.lastLoggedAt || ch.startedAt), quiet = now.getTime() - last > 3 * 86400000;
    let msg = null;
    if (p.reviewDue) msg = { title: `💯 ${first}, ${p.reviewDue} trades ka review baaki hai`, body: '5 minute lagenge. Review ke bina aage ke challenge trades nahi ginenge.', url: '/#challenge', tag: 'challenge-nudge' };
    else if (quiet) msg = { title: `💯 ${p.counted}/100 · ${ch.strategy}`, body: '3 din se koi challenge trade nahi aaya. Setup ka wait karna sahi hai — bas jo trade lo, journal zaroor karo.', url: '/#challenge', tag: 'challenge-nudge' };
    if (msg) sent += await sendPersonal(env, r.user_id, msg, { respectOff: true });
  }
  state.nudged = t.date; state.nudgeRun = null; state.lastNudge = { date: t.date, at: now.toISOString(), users, sent };
  return { users, sent, more: false };
}

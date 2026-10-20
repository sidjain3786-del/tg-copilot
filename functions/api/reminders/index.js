import { getUserFromRequest, json, readJson, ensureSchema, isAdminUser } from '../../_lib/auth.js';
import { getVapidKeys, sendTickle } from '../../_lib/push.js';
import { setLastPush } from '../../_lib/settings.js';
import { getReminders, getSetting, putSetting, cleanSlots, cleanNudge, istNow, recipients } from '../../_lib/reminders.js';

// GET  /api/reminders -> traders: times + whether they turned reminders off; admin: full settings + automation status
// PUT  /api/reminders (admin) { enabled, slots }
// POST /api/reminders { action: 'mine', off }            -> a trader turns daily reminders off / on
// POST /api/reminders { action: 'test', slot }  (admin) -> send that slot now to the admin's own devices
export async function onRequestGet({ request, env }) {
  try {
    const user = await getUserFromRequest(request, env);
    if (!user) return json({ error: 'Not authenticated' }, { status: 401 });
    await ensureSchema(env);
    const rem = await getReminders(env), pref = await env.DB.prepare('SELECT reminders_off FROM user_prefs WHERE user_id = ?').bind(user.id).first();
    const out = { enabled: rem.enabled, times: rem.slots.filter(s => s.on).map(s => ({ time: s.time, title: s.title })), myOff: !!pref?.reminders_off };
    if (!isAdminUser(user, env)) return json(out);
    const state = await getSetting(env, 'reminders_state', {});
    const off = (await env.DB.prepare('SELECT COUNT(*) AS n FROM user_prefs WHERE reminders_off = 1').first())?.n || 0;
    const devices = (await env.DB.prepare('SELECT COUNT(*) AS n FROM push_subscriptions').first())?.n || 0;
    return json({ ...out, slots: rem.slots, nudge: rem.nudge, lastNudge: state.lastNudge || null, cronSecretSet: !!env.CRON_SECRET, lastTick: state.lastTick || null, lastRun: state.lastRun || null, sentToday: state.sent || {}, today: istNow().date, tradersOff: off, devices });
  } catch (e) { console.error('reminders get', e); return json({ error: 'Load nahi hua.' }, { status: 500 }); }
}
export async function onRequestPut({ request, env }) {
  try {
    const user = await getUserFromRequest(request, env);
    if (!user) return json({ error: 'Not authenticated' }, { status: 401 });
    if (!isAdminUser(user, env)) return json({ error: 'Sirf admin.' }, { status: 403 });
    await ensureSchema(env);
    const b = await readJson(request) || {};
    const slots = cleanSlots(b.slots);
    if (b.enabled && !slots.length) return json({ error: 'Kam se kam ek reminder ka message likho.' }, { status: 400 });
    const nudge = cleanNudge(b.nudge);
    await putSetting(env, 'reminders', { enabled: !!b.enabled, slots, nudge });
    return json({ ok: true, enabled: !!b.enabled, slots, nudge });
  } catch (e) { console.error('reminders put', e); return json({ error: 'Save nahi hua.' }, { status: 500 }); }
}
export async function onRequestPost({ request, env }) {
  try {
    const user = await getUserFromRequest(request, env);
    if (!user) return json({ error: 'Not authenticated' }, { status: 401 });
    await ensureSchema(env);
    const b = await readJson(request) || {};
    if (b.action === 'mine') {
      await env.DB.prepare('INSERT INTO user_prefs (user_id, reminders_off) VALUES (?, ?) ON CONFLICT(user_id) DO UPDATE SET reminders_off = excluded.reminders_off').bind(user.id, b.off ? 1 : 0).run();
      return json({ ok: true, myOff: !!b.off });
    }
    if (b.action === 'test') {
      if (!isAdminUser(user, env)) return json({ error: 'Sirf admin.' }, { status: 403 });
      const rem = await getReminders(env), slot = cleanSlots(b.slots || rem.slots).find(s => s.id === b.slot);
      if (!slot) return json({ error: 'Pehle reminder save karo.' }, { status: 400 });
      const t = istNow(), devices = await recipients(env, { ...slot, target: 'all' }, t, user.id);
      if (!devices.length) return json({ error: 'Aapke kisi device par notification on nahi hai. Dashboard par 🔔 dabakar on karo, phir test karo.' }, { status: 400 });
      await setLastPush(env, { kind: 'reminder', slot: slot.id, date: t.date, at: new Date().toISOString(), preview: slot });
      const keys = await getVapidKeys(env), subject = `mailto:${String(env.ADMIN_EMAILS || 'admin@example.com').split(',')[0].trim()}`;
      let sent = 0; for (const ep of devices) if (await sendTickle(ep, keys, subject) === 'ok') sent++;
      return json({ ok: true, sent });
    }
    return json({ error: 'Unknown action' }, { status: 400 });
  } catch (e) { console.error('reminders post', e); return json({ error: 'Nahi hua.' }, { status: 500 }); }
}

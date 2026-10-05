import { getUserFromRequest, json, ensureSchema } from '../../_lib/auth.js';
// GET /api/notify/latest -> what the last push notification was about, for the service worker.
const TAB_URL = { log: '/#log', notes: '/#notes', history: '/#history', blog: '/#blog', report: '/#copilot', analysis: '/#analysis', '': '/#copilot' };
export async function onRequestGet({ request, env }) {
  const user = await getUserFromRequest(request, env);
  if (!user) return json({ title: 'Trader Co-Pilot', body: 'Naya update aaya hai — dekhne ke liye tap karo.', url: '/' });
  await ensureSchema(env);
  let last = null; try { last = JSON.parse((await env.DB.prepare(`SELECT value FROM app_settings WHERE key = 'last_push'`).first())?.value || 'null'); } catch {}
  if (last?.kind === 'announcement') {
    const a = await env.DB.prepare('SELECT title, body, cta FROM announcements WHERE id = ?').bind(last.id).first();
    if (a) return json({ title: `📢 ${a.title}`, body: a.body || 'Tap karke dekho.', url: TAB_URL[a.cta] || '/#copilot', tag: 'announcement' });
  }
  const q = await env.DB.prepare('SELECT text, author FROM quotes ORDER BY created_at DESC LIMIT 1').first();
  if (q) return json({ title: '💬 Quote of the Day', body: `“${q.text}”${q.author ? ' — ' + q.author : ''}`, url: '/#copilot', tag: 'quote-of-the-day' });
  return json({ title: 'Trader Co-Pilot', body: 'Naya update aaya hai.', url: '/' });
}

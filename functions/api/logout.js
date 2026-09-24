import { getCookie, clearCookie, json } from '../_lib/auth.js';

export async function onRequestPost({ request, env }) {
  const sid = getCookie(request, 'session');
  if (sid) await env.DB.prepare('DELETE FROM sessions WHERE id = ?').bind(sid).run();
  return json({ ok: true }, { headers: { 'Set-Cookie': clearCookie() } });
}

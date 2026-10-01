import { getCookie, clearCookie, json } from '../_lib/auth.js';

export async function onRequestPost({ request, env }) {
  try {
    const sid = getCookie(request, 'session');
    if (sid) await env.DB.prepare('DELETE FROM sessions WHERE id = ?').bind(sid).run();
  } catch (e) {
    console.error('logout error', e);
  }
  return json({ ok: true }, { headers: { 'Set-Cookie': clearCookie() } });
}

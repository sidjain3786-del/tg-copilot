import { hashPassword, createSession, sessionCookie, json } from '../_lib/auth.js';

export async function onRequestPost({ request, env }) {
  try {
    const { email, password } = await request.json();
    const cleanEmail = String(email || '').trim().toLowerCase();
    const user = await env.DB.prepare('SELECT * FROM users WHERE email = ?').bind(cleanEmail).first();
    if (!user) return json({ error: 'Invalid email or password.' }, { status: 401 });

    const { hash } = await hashPassword(password, user.salt);
    if (hash !== user.password_hash) return json({ error: 'Invalid email or password.' }, { status: 401 });

    const sessionId = await createSession(env, user.id);
    return json(
      { id: user.id, email: user.email, name: user.name },
      { headers: { 'Set-Cookie': sessionCookie(sessionId) } }
    );
  } catch (e) {
    return json({ error: e.message }, { status: 500 });
  }
}

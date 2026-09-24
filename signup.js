import { hashPassword, createSession, sessionCookie, json } from '../_lib/auth.js';

export async function onRequestPost({ request, env }) {
  try {
    const { name, email, password } = await request.json();
    if (!name || !email || !password || password.length < 6) {
      return json({ error: 'Please fill name, email, and a password of at least 6 characters.' }, { status: 400 });
    }
    const cleanEmail = String(email).trim().toLowerCase();
    const existing = await env.DB.prepare('SELECT id FROM users WHERE email = ?').bind(cleanEmail).first();
    if (existing) {
      return json({ error: 'An account with this email already exists.' }, { status: 400 });
    }
    const { hash, salt } = await hashPassword(password);
    const id = crypto.randomUUID();
    const createdAt = new Date().toISOString();

    await env.DB.prepare(
      'INSERT INTO users (id, email, name, password_hash, salt, created_at) VALUES (?, ?, ?, ?, ?, ?)'
    ).bind(id, cleanEmail, name, hash, salt, createdAt).run();

    await env.DB.prepare(
      'INSERT INTO user_data (user_id, trades, notes, custom_strategies, updated_at) VALUES (?, ?, ?, ?, ?)'
    ).bind(id, '[]', '[]', '[]', createdAt).run();

    const sessionId = await createSession(env, id);
    return json({ id, email: cleanEmail, name }, { headers: { 'Set-Cookie': sessionCookie(sessionId) } });
  } catch (e) {
    return json({ error: e.message }, { status: 500 });
  }
}

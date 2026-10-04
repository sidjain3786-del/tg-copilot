import { hashPassword, createSession, sessionCookie, json, readJson, EMAIL_RE, isAdminUser } from '../_lib/auth.js';

export async function onRequestPost({ request, env }) {
  try {
    const body = await readJson(request);
    if (!body) return json({ error: 'Invalid request.' }, { status: 400 });
    const name = String(body.name || '').trim().slice(0, 60);
    const cleanEmail = String(body.email || '').trim().toLowerCase();
    const password = String(body.password || '');
    if (!name || !cleanEmail || password.length < 6) {
      return json({ error: 'Please fill name, email, and a password of at least 6 characters.' }, { status: 400 });
    }
    if (!EMAIL_RE.test(cleanEmail) || cleanEmail.length > 254) {
      return json({ error: 'Please enter a valid email address.' }, { status: 400 });
    }
    if (password.length > 200) {
      return json({ error: 'Password is too long (max 200 characters).' }, { status: 400 });
    }
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
    return json({ id, email: cleanEmail, name, isAdmin: isAdminUser({ email: cleanEmail }, env) }, { headers: { 'Set-Cookie': sessionCookie(sessionId) } });
  } catch (e) {
    console.error('signup error', e);
    return json({ error: 'Sign up failed. Please try again.' }, { status: 500 });
  }
}

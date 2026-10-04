import { hashPassword, createSession, sessionCookie, json, readJson, safeEqual, ensureSchema, isAdminUser } from '../_lib/auth.js';

const MAX_FAILURES = 8;              // failed attempts allowed...
const WINDOW_MS = 15 * 60 * 1000;    // ...per 15 minutes, per email

export async function onRequestPost({ request, env }) {
  try {
    const body = await readJson(request);
    if (!body) return json({ error: 'Invalid request.' }, { status: 400 });
    const cleanEmail = String(body.email || '').trim().toLowerCase();
    const password = String(body.password || '');
    if (!cleanEmail || !password) return json({ error: 'Email aur password dono bharo.' }, { status: 400 });

    await ensureSchema(env);
    const now = Date.now();
    const attempt = await env.DB.prepare('SELECT failures, window_start FROM login_attempts WHERE email = ?').bind(cleanEmail).first();
    const inWindow = attempt && (now - new Date(attempt.window_start).getTime()) < WINDOW_MS;
    if (inWindow && attempt.failures >= MAX_FAILURES) {
      return json({ error: 'Bahut zyada galat attempts. 15 minute baad try karo.' }, { status: 429 });
    }

    const user = await env.DB.prepare('SELECT * FROM users WHERE email = ?').bind(cleanEmail).first();
    const { hash } = user ? await hashPassword(password, user.salt) : { hash: '' };
    if (!user || !safeEqual(hash, user.password_hash)) {
      if (inWindow) await env.DB.prepare('UPDATE login_attempts SET failures = failures + 1 WHERE email = ?').bind(cleanEmail).run();
      else await env.DB.prepare('INSERT INTO login_attempts (email, failures, window_start) VALUES (?, 1, ?) ON CONFLICT(email) DO UPDATE SET failures = 1, window_start = excluded.window_start').bind(cleanEmail, new Date(now).toISOString()).run();
      return json({ error: 'Invalid email or password.' }, { status: 401 });
    }

    await env.DB.prepare('DELETE FROM login_attempts WHERE email = ?').bind(cleanEmail).run();
    const sessionId = await createSession(env, user.id);
    return json(
      { id: user.id, email: user.email, name: user.name, isAdmin: isAdminUser(user, env) },
      { headers: { 'Set-Cookie': sessionCookie(sessionId) } }
    );
  } catch (e) {
    console.error('login error', e);
    return json({ error: 'Login failed. Please try again.' }, { status: 500 });
  }
}

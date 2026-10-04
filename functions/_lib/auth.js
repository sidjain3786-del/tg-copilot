// Shared auth + DB utilities for Cloudflare Pages Functions.
// Uses the Web Crypto API (built into the Workers runtime) — no external libraries needed.

function toHex(buffer) {
  return [...new Uint8Array(buffer)].map(b => b.toString(16).padStart(2, '0')).join('');
}

function fromHex(hex) {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(hex.substr(i * 2, 2), 16);
  return bytes;
}

// PBKDF2-SHA256, 100k iterations, random 16-byte salt per user.
export async function hashPassword(password, existingSaltHex) {
  const enc = new TextEncoder();
  const salt = existingSaltHex ? fromHex(existingSaltHex) : crypto.getRandomValues(new Uint8Array(16));
  const keyMaterial = await crypto.subtle.importKey('raw', enc.encode(String(password)), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt, iterations: 100000, hash: 'SHA-256' }, keyMaterial, 256);
  return { hash: toHex(bits), salt: toHex(salt) };
}

// Constant-time string compare (avoids leaking how many hex chars matched).
export function safeEqual(a, b) {
  a = String(a || ''); b = String(b || '');
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export function getCookie(request, name) {
  const cookieHeader = request.headers.get('Cookie') || '';
  const match = cookieHeader.match(new RegExp('(?:^|; )' + name + '=([^;]*)'));
  return match ? decodeURIComponent(match[1]) : null;
}

export function sessionCookie(sessionId) {
  return `session=${sessionId}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=2592000`;
}

export function clearCookie() {
  return `session=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0`;
}

// Tables added after the first release. Created once per Worker isolate
// instead of on every request.
let schemaReady = false;
export async function ensureSchema(env) {
  if (schemaReady) return;
  await env.DB.prepare(`CREATE TABLE IF NOT EXISTS user_session_notes (user_id TEXT PRIMARY KEY, notes TEXT NOT NULL DEFAULT '{}', updated_at TEXT NOT NULL, FOREIGN KEY (user_id) REFERENCES users(id))`).run();
  await env.DB.prepare(`CREATE TABLE IF NOT EXISTS login_attempts (email TEXT PRIMARY KEY, failures INTEGER NOT NULL DEFAULT 0, window_start TEXT NOT NULL)`).run();
  await env.DB.prepare(`CREATE TABLE IF NOT EXISTS blog_posts (id TEXT PRIMARY KEY, slug TEXT UNIQUE NOT NULL, title TEXT NOT NULL, excerpt TEXT NOT NULL DEFAULT '', cover TEXT NOT NULL DEFAULT '', tags TEXT NOT NULL DEFAULT '[]', blocks TEXT NOT NULL DEFAULT '[]', status TEXT NOT NULL DEFAULT 'draft', author_id TEXT, author_name TEXT, read_minutes INTEGER NOT NULL DEFAULT 1, views INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, published_at TEXT)`).run();
  await env.DB.prepare(`CREATE INDEX IF NOT EXISTS idx_blog_status_pub ON blog_posts (status, published_at)`).run();
  await env.DB.prepare(`CREATE TABLE IF NOT EXISTS quotes (id TEXT PRIMARY KEY, text TEXT NOT NULL, author TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL, created_by TEXT, notified INTEGER NOT NULL DEFAULT 0)`).run();
  await env.DB.prepare(`CREATE TABLE IF NOT EXISTS push_subscriptions (endpoint TEXT PRIMARY KEY, user_id TEXT NOT NULL, created_at TEXT NOT NULL, last_ok_at TEXT, fails INTEGER NOT NULL DEFAULT 0)`).run();
  await env.DB.prepare(`CREATE TABLE IF NOT EXISTS app_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)`).run();
  await env.DB.prepare(`CREATE TABLE IF NOT EXISTS user_activity (user_id TEXT PRIMARY KEY, last_seen_at TEXT, last_save_at TEXT, saves INTEGER NOT NULL DEFAULT 0, visits INTEGER NOT NULL DEFAULT 0)`).run();
  schemaReady = true;
}

export async function createSession(env, userId) {
  const id = crypto.randomUUID();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000).toISOString();
  // Housekeeping: drop this user's expired sessions so the table doesn't grow forever.
  await env.DB.prepare('DELETE FROM sessions WHERE user_id = ? AND expires_at < ?').bind(userId, now.toISOString()).run();
  await env.DB.prepare('INSERT INTO sessions (id, user_id, expires_at) VALUES (?, ?, ?)').bind(id, userId, expiresAt).run();
  return id;
}

// Returns {id, email, name} for a valid session, or null.
export async function getUserFromRequest(request, env) {
  const sid = getCookie(request, 'session');
  if (!sid) return null;
  const session = await env.DB.prepare('SELECT user_id, expires_at FROM sessions WHERE id = ?').bind(sid).first();
  if (!session) return null;
  if (new Date(session.expires_at) < new Date()) {
    await env.DB.prepare('DELETE FROM sessions WHERE id = ?').bind(sid).run();
    return null;
  }
  const user = await env.DB.prepare('SELECT id, email, name FROM users WHERE id = ?').bind(session.user_id).first();
  return user || null;
}

export function json(data, init = {}) {
  return new Response(JSON.stringify(data), {
    status: init.status || 200,
    headers: { 'Content-Type': 'application/json', ...(init.headers || {}) }
  });
}

// Parse a request body as JSON; returns null instead of throwing.
export async function readJson(request) {
  try {
    const body = await request.json();
    return body && typeof body === 'object' ? body : null;
  } catch {
    return null;
  }
}

// Parse a stored JSON column safely.
export function parseColumn(text, fallback) {
  try {
    const v = JSON.parse(text);
    return v ?? fallback;
  } catch {
    return fallback;
  }
}

export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

// Activity for the admin dashboard (traders are told mentors can see their journal).
export async function touchActivity(env, userId, kind) {
  try {
    await ensureSchema(env);
    const now = new Date().toISOString();
    if (kind === 'save') {
      await env.DB.prepare(`INSERT INTO user_activity (user_id, last_seen_at, last_save_at, saves, visits) VALUES (?, ?, ?, 1, 0)
        ON CONFLICT(user_id) DO UPDATE SET last_seen_at = excluded.last_seen_at, last_save_at = excluded.last_save_at, saves = saves + 1`).bind(userId, now, now).run();
    } else {
      await env.DB.prepare(`INSERT INTO user_activity (user_id, last_seen_at, visits) VALUES (?, ?, 1)
        ON CONFLICT(user_id) DO UPDATE SET last_seen_at = excluded.last_seen_at, visits = visits + 1`).bind(userId, now).run();
    }
  } catch (e) { console.error('activity', e); }
}

// Admins are set in Cloudflare Pages → Settings → Variables: ADMIN_EMAILS = "a@x.com, b@y.com"
export function isAdminUser(user, env) {
  if (!user || !user.email) return false;
  const list = String(env.ADMIN_EMAILS || '').split(',').map(x => x.trim().toLowerCase()).filter(Boolean);
  return list.includes(String(user.email).toLowerCase());
}

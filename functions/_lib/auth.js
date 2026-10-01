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

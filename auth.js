// Shared auth utilities for Cloudflare Pages Functions.
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
  const keyMaterial = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt, iterations: 100000, hash: 'SHA-256' }, keyMaterial, 256);
  return { hash: toHex(bits), salt: toHex(salt) };
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

export async function createSession(env, userId) {
  const id = crypto.randomUUID();
  const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
  await env.DB.prepare('INSERT INTO sessions (id, user_id, expires_at) VALUES (?, ?, ?)').bind(id, userId, expiresAt).run();
  return id;
}

// Returns {id, email, name} for a valid session, or null.
export async function getUserFromRequest(request, env) {
  const sid = getCookie(request, 'session');
  if (!sid) return null;
  const session = await env.DB.prepare('SELECT user_id, expires_at FROM sessions WHERE id = ?').bind(sid).first();
  if (!session) return null;
  if (new Date(session.expires_at) < new Date()) return null;
  const user = await env.DB.prepare('SELECT id, email, name FROM users WHERE id = ?').bind(session.user_id).first();
  return user || null;
}

export function json(data, init = {}) {
  return new Response(JSON.stringify(data), {
    status: init.status || 200,
    headers: { 'Content-Type': 'application/json', ...(init.headers || {}) }
  });
}

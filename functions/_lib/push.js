// Web Push without payload (RFC 8030 + VAPID RFC 8292).
// We send an empty "tickle"; the service worker then fetches the latest quote itself,
// so no message encryption is needed. VAPID keys are created once and kept in D1
// (or set VAPID_PUBLIC_KEY / VAPID_PRIVATE_JWK in Cloudflare to override).
const b64u = buf => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const b64uStr = str => b64u(new TextEncoder().encode(str));

export async function getVapidKeys(env) {
  if (env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_JWK) return { publicKey: env.VAPID_PUBLIC_KEY, privateJwk: JSON.parse(env.VAPID_PRIVATE_JWK) };
  const row = await env.DB.prepare(`SELECT value FROM app_settings WHERE key = 'vapid'`).first();
  if (row) return JSON.parse(row.value);
  const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  const keys = { publicKey: b64u(await crypto.subtle.exportKey('raw', pair.publicKey)), privateJwk: await crypto.subtle.exportKey('jwk', pair.privateKey) };
  // INSERT OR IGNORE: if two requests race, both end up using the stored pair.
  await env.DB.prepare(`INSERT OR IGNORE INTO app_settings (key, value) VALUES ('vapid', ?)`).bind(JSON.stringify(keys)).run();
  return JSON.parse((await env.DB.prepare(`SELECT value FROM app_settings WHERE key = 'vapid'`).first()).value);
}

export async function vapidAuthHeader(endpoint, keys, subject) {
  const aud = new URL(endpoint).origin;
  const header = b64uStr(JSON.stringify({ typ: 'JWT', alg: 'ES256' }));
  const payload = b64uStr(JSON.stringify({ aud, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: subject }));
  const key = await crypto.subtle.importKey('jwk', { ...keys.privateJwk, key_ops: ['sign'] }, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, new TextEncoder().encode(`${header}.${payload}`));
  return `vapid t=${header}.${payload}.${b64u(sig)}, k=${keys.publicKey}`;
}

// returns 'ok' | 'gone' (subscription expired, delete it) | 'error'
export async function sendTickle(endpoint, keys, subject) {
  try {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { Authorization: await vapidAuthHeader(endpoint, keys, subject), TTL: '86400', Urgency: 'normal', 'Content-Length': '0' }
    });
    if (res.status === 404 || res.status === 410) return 'gone';
    return res.ok ? 'ok' : 'error';
  } catch { return 'error'; }
}

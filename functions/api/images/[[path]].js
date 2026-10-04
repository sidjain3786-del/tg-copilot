import { getUserFromRequest, json, isAdminUser } from '../../_lib/auth.js';

// Serves a chart image from R2. Users can only read images inside their own folder.
// Self-heal: if a stored file is base64 / data-URL TEXT instead of real image bytes,
// it is decoded, served correctly, and written back fixed. Unreadable files get 422.

function sniff(bytes) {
  const b = bytes;
  if (b.length >= 3 && b[0] === 0xFF && b[1] === 0xD8 && b[2] === 0xFF) return 'image/jpeg';
  if (b.length >= 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4E && b[3] === 0x47) return 'image/png';
  if (b.length >= 6 && b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x38) return 'image/gif';
  if (b.length >= 12 && b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) return 'image/webp';
  return null;
}

function decodeTextImage(bytes) {
  let text;
  try { text = new TextDecoder('utf-8', { fatal: true }).decode(bytes).trim(); } catch { return null; }
  text = text.replace(/^"+|"+$/g, '');                    // JSON-quoted string
  const m = /^data:image\/[a-z+.-]+;base64,(.*)$/is.exec(text);
  let b64 = (m ? m[1] : text).replace(/\s/g, '').replace(/-/g, '+').replace(/_/g, '/');
  if (!/^[A-Za-z0-9+/=]+$/.test(b64) || b64.length < 16) return null;
  while (b64.length % 4) b64 += '=';
  try {
    const bin = atob(b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    const type = sniff(out);
    return type ? { bytes: out, type } : null;
  } catch { return null; }
}

export async function onRequestGet({ request, env, params }) {
  const user = await getUserFromRequest(request, env);
  if (!user) return json({ error: 'Not authenticated' }, { status: 401 });
  if (!env.IMAGES) return json({ error: 'Image storage not configured' }, { status: 501 });

  const parts = Array.isArray(params.path) ? params.path : [params.path];
  const owner = parts[0] === user.id || isAdminUser(user, env);   // admins (mentors) can view traders' charts
  if (parts.length !== 2 || !owner || !/^[A-Za-z0-9-]{1,64}$/.test(parts[0]) || !/^[0-9a-f-]{36}\.(jpg|png|webp|gif)$/.test(parts[1])) {
    return json({ error: 'Not found' }, { status: 404 });
  }
  const key = parts.join('/');
  const obj = await env.IMAGES.get(key);
  if (!obj) return json({ error: 'Not found' }, { status: 404 });

  const bytes = new Uint8Array(typeof obj.arrayBuffer === 'function' ? await obj.arrayBuffer() : await new Response(obj.body).arrayBuffer());
  let type = sniff(bytes);
  let body = bytes;
  if (!type) {
    const fixed = decodeTextImage(bytes);
    if (!fixed) return json({ error: 'corrupt', size: bytes.length }, { status: 422 });
    body = fixed.bytes; type = fixed.type;
    await env.IMAGES.put(key, body, { httpMetadata: { contentType: type } });   // heal it for next time
  }
  return new Response(body, {
    headers: { 'Content-Type': type, 'Cache-Control': 'private, max-age=86400' }
  });
}

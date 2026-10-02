import { getUserFromRequest, json, readJson } from '../_lib/auth.js';

// Stores one chart screenshot in R2 (binding: IMAGES) and returns its URL.
// Body: { dataUrl: "data:image/jpeg;base64,..." }
const TYPES = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif' };
const MAX_BYTES = 5 * 1024 * 1024;

export async function onRequestPost({ request, env }) {
  try {
    const user = await getUserFromRequest(request, env);
    if (!user) return json({ error: 'Not authenticated' }, { status: 401 });
    if (!env.IMAGES) return json({ error: 'Image storage (R2 binding IMAGES) is not configured.' }, { status: 501 });

    const body = await readJson(request);
    const match = /^data:(image\/[a-z+.-]+);base64,([A-Za-z0-9+/=_\-\s]+)$/i.exec(String(body?.dataUrl || ''));
    let type = match ? match[1].toLowerCase() : '';
    if (type === 'image/jpg' || type === 'image/pjpeg') type = 'image/jpeg';
    if (!match || !TYPES[type]) return json({ error: 'Only JPG, PNG, WEBP or GIF images are allowed.' }, { status: 400 });
    match[1] = type;
    match[2] = match[2].replace(/-/g, '+').replace(/_/g, '/');
    while (match[2].replace(/\s/g, '').length % 4) match[2] += '=';

    const binary = atob(match[2].replace(/\s/g, ''));
    if (binary.length > MAX_BYTES) return json({ error: 'Image too large (max 5 MB).' }, { status: 413 });
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);

    const key = `${user.id}/${crypto.randomUUID()}.${TYPES[match[1]]}`;
    await env.IMAGES.put(key, bytes, { httpMetadata: { contentType: match[1] } });
    return json({ url: `/api/img/${key}` });
  } catch (e) {
    console.error('upload error', e);
    return json({ error: 'Image upload failed. Please try again.' }, { status: 500 });
  }
}

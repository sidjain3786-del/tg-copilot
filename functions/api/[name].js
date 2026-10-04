import { json } from '../../_lib/auth.js';
// Public read of blog images (names are random UUIDs).
export async function onRequestGet({ env, params }) {
  const name = String(params.name || '');
  if (!/^[0-9a-f-]{36}\.(jpg|png|webp|gif)$/.test(name)) return json({ error: 'Not found' }, { status: 404 });
  if (!env.IMAGES) return json({ error: 'Image storage not configured' }, { status: 501 });
  const obj = await env.IMAGES.get(`blog/${name}`);
  if (!obj) return json({ error: 'Not found' }, { status: 404 });
  return new Response(obj.body, { headers: { 'Content-Type': obj.httpMetadata?.contentType || 'image/jpeg', 'Cache-Control': 'public, max-age=604800' } });
}

import { getUserFromRequest, json } from '../../_lib/auth.js';
// GET /api/comp-img/<file> -> screenshots shared in a competition (any logged-in trader)
export async function onRequestGet({ request, env, params }) {
  const user = await getUserFromRequest(request, env);
  if (!user) return json({ error: 'Not authenticated' }, { status: 401 });
  const name = String(params.name || '');
  if (!/^[0-9a-f-]{36}\.(jpg|png|webp|gif)$/.test(name)) return json({ error: 'Not found' }, { status: 404 });
  if (!env.IMAGES) return json({ error: 'Image storage not configured' }, { status: 501 });
  const obj = await env.IMAGES.get(`comp/${name}`);
  if (!obj) return json({ error: 'Not found' }, { status: 404 });
  return new Response(obj.body, { headers: { 'Content-Type': obj.httpMetadata?.contentType || 'image/jpeg', 'Cache-Control': 'private, max-age=86400' } });
}

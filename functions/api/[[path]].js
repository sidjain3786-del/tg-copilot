import { getUserFromRequest, json } from '../../_lib/auth.js';

// Serves a chart image from R2. Users can only read images inside their own folder.
export async function onRequestGet({ request, env, params }) {
  const user = await getUserFromRequest(request, env);
  if (!user) return json({ error: 'Not authenticated' }, { status: 401 });
  if (!env.IMAGES) return json({ error: 'Image storage not configured' }, { status: 501 });

  const parts = Array.isArray(params.path) ? params.path : [params.path];
  if (parts.length !== 2 || parts[0] !== user.id || !/^[0-9a-f-]{36}\.(jpg|png|webp|gif)$/.test(parts[1])) {
    return json({ error: 'Not found' }, { status: 404 });
  }
  const obj = await env.IMAGES.get(parts.join('/'));
  if (!obj) return json({ error: 'Not found' }, { status: 404 });
  return new Response(obj.body, {
    headers: {
      'Content-Type': obj.httpMetadata?.contentType || 'image/jpeg',
      'Cache-Control': 'private, max-age=31536000, immutable'
    }
  });
}

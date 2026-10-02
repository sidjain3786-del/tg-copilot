import { getUserFromRequest, json, parseColumn } from '../_lib/auth.js';

// GET /api/img-health — tells the signed-in user whether their chart images are reachable.
// { binding, referenced, found, missing:[urls], inline }
export async function onRequestGet({ request, env }) {
  try {
    const user = await getUserFromRequest(request, env);
    if (!user) return json({ error: 'Not authenticated' }, { status: 401 });
    const row = await env.DB.prepare('SELECT trades, notes FROM user_data WHERE user_id = ?').bind(user.id).first();
    const text = (row ? String(row.trades || '') + String(row.notes || '') : '');
    const urls = [...new Set(text.match(/\/api\/img\/[A-Za-z0-9-]+\/[A-Za-z0-9-]+\.(?:jpg|png|webp|gif)/g) || [])];
    const inline = (text.match(/data:image\//g) || []).length;
    if (!env.IMAGES) return json({ binding: false, referenced: urls.length, found: 0, missing: urls, inline });
    const missing = [];
    for (const u of urls) {
      const key = u.replace('/api/img/', '');
      const head = await env.IMAGES.head(key);
      if (!head) missing.push(u);
    }
    return json({ binding: true, referenced: urls.length, found: urls.length - missing.length, missing, inline });
  } catch (e) {
    console.error('img-health error', e);
    return json({ error: 'Image check failed.' }, { status: 500 });
  }
}

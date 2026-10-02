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
    if (!env.IMAGES) return json({ binding: false, referenced: urls.length, found: 0, missing: urls, damaged: [], inline });
    const missing = [], damaged = [];
    for (const u of urls) {
      const key = u.replace('/api/img/', '');
      const obj = await env.IMAGES.get(key, { range: { offset: 0, length: 16 } });
      if (!obj) { missing.push(u); continue; }
      const b = new Uint8Array(await obj.arrayBuffer());
      const isImage = (b[0] === 0xFF && b[1] === 0xD8) || (b[0] === 0x89 && b[1] === 0x50) || (b[0] === 0x47 && b[1] === 0x49) || (b[0] === 0x52 && b[1] === 0x49 && b[8] === 0x57);
      const isText = b.length && [...b].every(x => x === 0x22 || (x >= 0x20 && x < 0x7f));   // base64 / data-URL text -> auto-repaired when opened
      if (!isImage && !isText) damaged.push(u);
    }
    return json({ binding: true, referenced: urls.length, found: urls.length - missing.length, missing, damaged, inline });
  } catch (e) {
    console.error('img-health error', e);
    return json({ error: 'Image check failed.' }, { status: 500 });
  }
}

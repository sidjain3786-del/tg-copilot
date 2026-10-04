import { getUserFromRequest, json, readJson } from '../_lib/auth.js';
import { download, directImageUrl, blockedHost, toBase64, EXT, INLINE_MAX } from '../_lib/image.js';

// POST /api/fetch-image  { url }
// Downloads an image from a link (direct image, TradingView snapshot /x/ link, or any page
// with an og:image) and stores a copy in R2, so the journal never depends on the link.
// Returns { url: "/api/img/..." } — or { dataUrl } when R2 isn't configured.

export async function onRequestPost({ request, env }) {
  try {
    const user = await getUserFromRequest(request, env);
    if (!user) return json({ error: 'Not authenticated' }, { status: 401 });
    const body = await readJson(request);
    let u;
    try { u = new URL(String(body?.url || '').trim()); } catch { return json({ error: 'Sahi link paste karo (https://… se shuru).' }, { status: 400 }); }
    if (!/^https?:$/.test(u.protocol) || blockedHost(u.hostname)) return json({ error: 'Yeh link allowed nahi hai.' }, { status: 400 });

    const { bytes, type } = await download(directImageUrl(u));

    if (env.IMAGES) {
      const key = `${user.id}/${crypto.randomUUID()}.${EXT[type]}`;
      await env.IMAGES.put(key, bytes, { httpMetadata: { contentType: type } });
      return json({ url: `/api/img/${key}`, type, size: bytes.length });
    }
    if (bytes.length > INLINE_MAX) return json({ error: 'Image badi hai aur image storage (R2) connected nahi hai.' }, { status: 413 });
    return json({ dataUrl: `data:${type};base64,${toBase64(bytes)}`, type, size: bytes.length });
  } catch (e) {
    if (e?.name === 'TimeoutError' || e?.name === 'AbortError') return json({ error: 'Link se image aane mein bahut time lag raha hai. Dobara try karo.' }, { status: 504 });
    if (e?.status) return json({ error: e.message }, { status: e.status });
    console.error('fetch-image error', e);
    return json({ error: 'Link se image nahi la paye. Link check karke dobara try karo.' }, { status: 502 });
  }
}

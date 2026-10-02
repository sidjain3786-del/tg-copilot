import { getUserFromRequest, json, readJson } from '../_lib/auth.js';

// POST /api/fetch-image  { url }
// Downloads an image from a link (direct image, TradingView snapshot /x/ link, or any page
// with an og:image) and stores a copy in R2, so the journal never depends on the link.
// Returns { url: "/api/img/..." } — or { dataUrl } when R2 isn't configured.

const MAX_BYTES = 8 * 1024 * 1024;
const INLINE_MAX = 1.5 * 1024 * 1024;
const EXT = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif' };

function sniff(b) {
  if (b[0] === 0xFF && b[1] === 0xD8 && b[2] === 0xFF) return 'image/jpeg';
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4E && b[3] === 0x47) return 'image/png';
  if (b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46) return 'image/gif';
  if (b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) return 'image/webp';
  return null;
}

function blockedHost(host) {
  const h = host.toLowerCase();
  return h === 'localhost' || h.endsWith('.local') || h.endsWith('.internal') || h === '0.0.0.0' ||
    /^127\./.test(h) || /^10\./.test(h) || /^192\.168\./.test(h) || /^169\.254\./.test(h) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(h) || h === '[::1]' || h.startsWith('[fc') || h.startsWith('[fd');
}

// TradingView share links (https://www.tradingview.com/x/AbC123/) point to a page;
// the picture itself lives at s3.tradingview.com/snapshots/<first letter>/<id>.png
function directImageUrl(u) {
  const tv = /^(?:www\.|in\.|[a-z]{2}\.)?tradingview\.com$/i.test(u.hostname) && /^\/x\/([A-Za-z0-9]+)\/?$/.exec(u.pathname);
  if (tv) return `https://s3.tradingview.com/snapshots/${tv[1][0].toLowerCase()}/${tv[1]}.png`;
  return u.toString();
}

async function download(url, depth = 0) {
  const res = await fetch(url, {
    redirect: 'follow',
    headers: { 'User-Agent': 'Mozilla/5.0 (TraderCopilot image fetch)', 'Accept': 'image/*,text/html;q=0.8,*/*;q=0.5' },
    signal: AbortSignal.timeout(15000)
  });
  if (!res.ok) throw Object.assign(new Error(`Link ne error diya (${res.status}).`), { status: 422 });
  const type = (res.headers.get('Content-Type') || '').split(';')[0].trim().toLowerCase();
  const len = Number(res.headers.get('Content-Length') || 0);
  if (len > MAX_BYTES) throw Object.assign(new Error('Image 8 MB se badi hai.'), { status: 413 });

  if (type.startsWith('text/html') && depth === 0) {
    // A web page: use its preview image (og:image / twitter:image) if it has one.
    const html = (await res.text()).slice(0, 400000);
    const m = /<meta[^>]+(?:property|name)=["'](?:og:image(?::secure_url)?|twitter:image)["'][^>]*content=["']([^"']+)["']/i.exec(html)
           || /<meta[^>]+content=["']([^"']+)["'][^>]*(?:property|name)=["'](?:og:image|twitter:image)["']/i.exec(html);
    if (!m) throw Object.assign(new Error('Is link mein image nahi mili. Seedha image ka link ya TradingView snapshot link do.'), { status: 422 });
    const next = new URL(m[1].replace(/&amp;/g, '&'), url);
    if (!/^https?:$/.test(next.protocol) || blockedHost(next.hostname)) throw Object.assign(new Error('Link allowed nahi hai.'), { status: 400 });
    return download(next.toString(), 1);
  }

  const buf = new Uint8Array(await res.arrayBuffer());
  if (buf.length > MAX_BYTES) throw Object.assign(new Error('Image 8 MB se badi hai.'), { status: 413 });
  const real = sniff(buf);
  if (!real) throw Object.assign(new Error('Link se jo file aayi woh image nahi hai (JPG/PNG/WEBP/GIF chahiye).'), { status: 422 });
  return { bytes: buf, type: real };
}

function toBase64(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

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

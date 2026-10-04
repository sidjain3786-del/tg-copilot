// Shared image helpers: type sniffing, safe link download (TradingView / og:image), base64.
export const MAX_BYTES = 8 * 1024 * 1024;
export const INLINE_MAX = 1.5 * 1024 * 1024;
export const EXT = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif' };

export function sniff(b) {
  if (b[0] === 0xFF && b[1] === 0xD8 && b[2] === 0xFF) return 'image/jpeg';
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4E && b[3] === 0x47) return 'image/png';
  if (b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46) return 'image/gif';
  if (b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) return 'image/webp';
  return null;
}

export function blockedHost(host) {
  const h = host.toLowerCase();
  return h === 'localhost' || h.endsWith('.local') || h.endsWith('.internal') || h === '0.0.0.0' ||
    /^127\./.test(h) || /^10\./.test(h) || /^192\.168\./.test(h) || /^169\.254\./.test(h) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(h) || h === '[::1]' || h.startsWith('[fc') || h.startsWith('[fd');
}

// TradingView share links (https://www.tradingview.com/x/AbC123/) point to a page;
// the picture itself lives at s3.tradingview.com/snapshots/<first letter>/<id>.png
export function directImageUrl(u) {
  const tv = /^(?:www\.|in\.|[a-z]{2}\.)?tradingview\.com$/i.test(u.hostname) && /^\/x\/([A-Za-z0-9]+)\/?$/.exec(u.pathname);
  if (tv) return `https://s3.tradingview.com/snapshots/${tv[1][0].toLowerCase()}/${tv[1]}.png`;
  return u.toString();
}

export async function download(url, depth = 0) {
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

export function toBase64(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(s);
}


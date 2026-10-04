import { getUserFromRequest, json, readJson, isAdminUser } from '../../_lib/auth.js';
import { download, directImageUrl, blockedHost, sniff, toBase64, EXT, INLINE_MAX } from '../../_lib/image.js';

// POST /api/blog/upload { dataUrl } | { url }  (admin) -> { url: "/api/blog-img/<uuid>.<ext>" }
// Blog images live in R2 under blog/ and are readable by every reader.
export async function onRequestPost({ request, env }) {
  try {
    const user = await getUserFromRequest(request, env);
    if (!user) return json({ error: 'Not authenticated' }, { status: 401 });
    if (!isAdminUser(user, env)) return json({ error: 'Sirf admin.' }, { status: 403 });
    const body = await readJson(request);
    let bytes, type;
    if (body?.url) {
      let u; try { u = new URL(String(body.url).trim()); } catch { return json({ error: 'Sahi link paste karo.' }, { status: 400 }); }
      if (!/^https?:$/.test(u.protocol) || blockedHost(u.hostname)) return json({ error: 'Yeh link allowed nahi hai.' }, { status: 400 });
      ({ bytes, type } = await download(directImageUrl(u)));
    } else {
      const m = /^data:image\/[a-z+.-]+;base64,([A-Za-z0-9+/=\s]+)$/i.exec(String(body?.dataUrl || ''));
      if (!m) return json({ error: 'Image sahi nahi hai.' }, { status: 400 });
      const bin = atob(m[1].replace(/\s/g, '')); bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      type = sniff(bytes);
      if (!type) return json({ error: 'Sirf JPG, PNG, WEBP ya GIF.' }, { status: 400 });
      if (bytes.length > 8 * 1024 * 1024) return json({ error: 'Image 8 MB se badi hai.' }, { status: 413 });
    }
    if (!env.IMAGES) {
      if (bytes.length > INLINE_MAX) return json({ error: 'Image badi hai aur R2 connected nahi hai.' }, { status: 413 });
      return json({ url: `data:${type};base64,${toBase64(bytes)}` });
    }
    const name = `${crypto.randomUUID()}.${EXT[type]}`;
    await env.IMAGES.put(`blog/${name}`, bytes, { httpMetadata: { contentType: type } });
    return json({ url: `/api/blog-img/${name}` });
  } catch (e) {
    if (e?.status) return json({ error: e.message }, { status: e.status });
    console.error('blog upload error', e);
    return json({ error: 'Image upload nahi hui.' }, { status: 500 });
  }
}

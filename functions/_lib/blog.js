// Blog post validation shared by the blog endpoints.
// Posts are stored as simple "blocks" (no raw HTML), so nothing an author types can run as code.
export const BLOCK_TYPES = new Set(['p', 'h2', 'h3', 'img', 'quote', 'list', 'callout', 'divider']);
const clip = (v, n) => String(v ?? '').slice(0, n);
const okImage = s => /^\/api\/blog-img\/[0-9a-f-]{36}\.(jpg|png|webp|gif)$/.test(s) || /^https:\/\/[^\s"'<>]+$/.test(s) || /^data:image\/(jpeg|png|webp|gif);base64,[A-Za-z0-9+/=]+$/.test(s);

export function cleanBlocks(input) {
  if (!Array.isArray(input)) return [];
  const out = [];
  for (const b of input.slice(0, 300)) {
    if (!b || !BLOCK_TYPES.has(b.type)) continue;
    if (b.type === 'divider') { out.push({ type: 'divider' }); continue; }
    if (b.type === 'img') {
      const src = String(b.src || '').trim();
      if (!okImage(src)) continue;
      out.push({ type: 'img', src, caption: clip(b.caption, 300) });
      continue;
    }
    if (b.type === 'list') {
      const items = (Array.isArray(b.items) ? b.items : String(b.text || '').split('\n'))
        .map(x => clip(x, 1000).trim()).filter(Boolean).slice(0, 60);
      if (items.length) out.push({ type: 'list', items });
      continue;
    }
    const text = clip(b.text, 12000);
    if (text.trim()) out.push({ type: b.type, text });
  }
  return out;
}
export function cleanTags(v) {
  const arr = Array.isArray(v) ? v : String(v || '').split(',');
  return [...new Set(arr.map(t => clip(t, 30).trim()).filter(Boolean))].slice(0, 8);
}
export function plainText(blocks) {
  return blocks.map(b => b.type === 'list' ? b.items.join(' ') : (b.text || b.caption || '')).join(' ')
    .replace(/\*\*|\*|\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/\s+/g, ' ').trim();
}
export function readMinutes(blocks) { return Math.max(1, Math.round(plainText(blocks).split(' ').filter(Boolean).length / 200)); }
export function makeSlug(title) {
  const base = String(title || 'post').toLowerCase().normalize('NFKD').replace(/[^a-z0-9\s-]/g, '').trim().replace(/\s+/g, '-').slice(0, 60) || 'post';
  return `${base}-${crypto.randomUUID().slice(0, 6)}`;
}
export function rowToPost(r, withBody = true) {
  let tags = [], blocks = [];
  try { tags = JSON.parse(r.tags || '[]'); } catch {}
  if (withBody) { try { blocks = JSON.parse(r.blocks || '[]'); } catch {} }
  return {
    id: r.id, slug: r.slug, title: r.title, excerpt: r.excerpt, cover: r.cover, tags,
    status: r.status, authorName: r.author_name || '', readMinutes: r.read_minutes, views: r.views,
    createdAt: r.created_at, updatedAt: r.updated_at, publishedAt: r.published_at,
    ...(withBody ? { blocks } : {})
  };
}
export function validatePost(body) {
  const title = clip(body?.title, 160).trim();
  if (!title) return { error: 'Post ka title likho.' };
  const blocks = cleanBlocks(body?.blocks);
  const cover = String(body?.cover || '').trim();
  if (cover && !okImage(cover)) return { error: 'Cover image sahi nahi hai.' };
  let excerpt = clip(body?.excerpt, 400).trim();
  if (!excerpt) excerpt = plainText(blocks).slice(0, 220);
  const status = body?.status === 'published' ? 'published' : 'draft';
  const blocksJson = JSON.stringify(blocks);
  if (new TextEncoder().encode(blocksJson).length > 1_800_000) return { error: 'Post bahut badi hai (images R2 mein upload hone chahiye).' };
  return { title, blocks, blocksJson, cover, excerpt, status, tags: cleanTags(body?.tags), minutes: readMinutes(blocks) };
}

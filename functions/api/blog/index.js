import { getUserFromRequest, json, readJson, ensureSchema, isAdminUser } from '../../_lib/auth.js';
import { validatePost, makeSlug, rowToPost } from '../../_lib/blog.js';

// GET  /api/blog            -> published posts (newest first). Admin: ?all=1 also returns drafts.
//      ?limit=20&before=<publishedAt>&tag=<tag>
// POST /api/blog            -> create post (admin only)
export async function onRequestGet({ request, env }) {
  try {
    const user = await getUserFromRequest(request, env);
    if (!user) return json({ error: 'Not authenticated' }, { status: 401 });
    await ensureSchema(env);
    const url = new URL(request.url);
    const admin = isAdminUser(user, env);
    const all = admin && url.searchParams.get('all') === '1';
    const limit = Math.min(50, Math.max(1, Number(url.searchParams.get('limit')) || 20));
    const before = url.searchParams.get('before');
    const where = [], args = [];
    if (!all) where.push(`status = 'published'`);
    if (before) { where.push(`COALESCE(published_at, updated_at) < ?`); args.push(before); }
    const sql = `SELECT id, slug, title, excerpt, cover, tags, status, author_name, read_minutes, views, created_at, updated_at, published_at FROM blog_posts ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY (status = 'draft') DESC, COALESCE(published_at, updated_at) DESC LIMIT ?`;
    const { results } = await env.DB.prepare(sql).bind(...args, limit + 1).all();
    let posts = results.map(r => rowToPost(r, false));
    const tag = url.searchParams.get('tag');
    if (tag) posts = posts.filter(p => p.tags.some(t => t.toLowerCase() === tag.toLowerCase()));
    const hasMore = posts.length > limit;
    return json({ posts: posts.slice(0, limit), hasMore, isAdmin: admin });
  } catch (e) {
    console.error('blog list error', e);
    return json({ error: 'Blog load nahi hua.' }, { status: 500 });
  }
}

export async function onRequestPost({ request, env }) {
  try {
    const user = await getUserFromRequest(request, env);
    if (!user) return json({ error: 'Not authenticated' }, { status: 401 });
    if (!isAdminUser(user, env)) return json({ error: 'Sirf admin post kar sakta hai.' }, { status: 403 });
    await ensureSchema(env);
    const body = await readJson(request);
    const v = validatePost(body);
    if (v.error) return json({ error: v.error }, { status: 400 });
    const id = crypto.randomUUID(), now = new Date().toISOString(), slug = makeSlug(v.title);
    await env.DB.prepare(`INSERT INTO blog_posts (id, slug, title, excerpt, cover, tags, blocks, status, author_id, author_name, read_minutes, views, created_at, updated_at, published_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?)`)
      .bind(id, slug, v.title, v.excerpt, v.cover, JSON.stringify(v.tags), v.blocksJson, v.status, user.id, user.name || '', v.minutes, now, now, v.status === 'published' ? now : null).run();
    const row = await env.DB.prepare('SELECT * FROM blog_posts WHERE id = ?').bind(id).first();
    return json({ post: rowToPost(row) });
  } catch (e) {
    console.error('blog create error', e);
    return json({ error: 'Post save nahi hua.' }, { status: 500 });
  }
}

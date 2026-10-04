import { getUserFromRequest, json, readJson, ensureSchema, isAdminUser } from '../../_lib/auth.js';
import { validatePost, rowToPost } from '../../_lib/blog.js';

// GET    /api/blog/<id or slug>  -> one post (drafts only for admin; counts a view for readers)
// PUT    /api/blog/<id>          -> update (admin)
// DELETE /api/blog/<id>          -> delete (admin)
async function findPost(env, key) {
  return env.DB.prepare('SELECT * FROM blog_posts WHERE id = ? OR slug = ?').bind(key, key).first();
}

export async function onRequestGet({ request, env, params }) {
  try {
    const user = await getUserFromRequest(request, env);
    if (!user) return json({ error: 'Not authenticated' }, { status: 401 });
    await ensureSchema(env);
    const row = await findPost(env, String(params.id));
    const admin = isAdminUser(user, env);
    if (!row || (row.status !== 'published' && !admin)) return json({ error: 'Post nahi mili.' }, { status: 404 });
    if (!admin && row.status === 'published') {
      await env.DB.prepare('UPDATE blog_posts SET views = views + 1 WHERE id = ?').bind(row.id).run();
      row.views += 1;
    }
    return json({ post: rowToPost(row) });
  } catch (e) {
    console.error('blog get error', e);
    return json({ error: 'Post load nahi hui.' }, { status: 500 });
  }
}

export async function onRequestPut({ request, env, params }) {
  try {
    const user = await getUserFromRequest(request, env);
    if (!user) return json({ error: 'Not authenticated' }, { status: 401 });
    if (!isAdminUser(user, env)) return json({ error: 'Sirf admin edit kar sakta hai.' }, { status: 403 });
    await ensureSchema(env);
    const row = await findPost(env, String(params.id));
    if (!row) return json({ error: 'Post nahi mili.' }, { status: 404 });
    const v = validatePost(await readJson(request));
    if (v.error) return json({ error: v.error }, { status: 400 });
    const now = new Date().toISOString();
    const publishedAt = v.status === 'published' ? (row.published_at || now) : null;
    await env.DB.prepare(`UPDATE blog_posts SET title = ?, excerpt = ?, cover = ?, tags = ?, blocks = ?, status = ?, read_minutes = ?, updated_at = ?, published_at = ? WHERE id = ?`)
      .bind(v.title, v.excerpt, v.cover, JSON.stringify(v.tags), v.blocksJson, v.status, v.minutes, now, publishedAt, row.id).run();
    return json({ post: rowToPost(await findPost(env, row.id)) });
  } catch (e) {
    console.error('blog update error', e);
    return json({ error: 'Post update nahi hui.' }, { status: 500 });
  }
}

export async function onRequestDelete({ request, env, params }) {
  try {
    const user = await getUserFromRequest(request, env);
    if (!user) return json({ error: 'Not authenticated' }, { status: 401 });
    if (!isAdminUser(user, env)) return json({ error: 'Sirf admin delete kar sakta hai.' }, { status: 403 });
    await ensureSchema(env);
    await env.DB.prepare('DELETE FROM blog_posts WHERE id = ?').bind(String(params.id)).run();
    return json({ ok: true });
  } catch (e) {
    console.error('blog delete error', e);
    return json({ error: 'Post delete nahi hui.' }, { status: 500 });
  }
}

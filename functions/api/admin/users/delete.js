import { getUserFromRequest, json, readJson, ensureSchema, isAdminUser } from '../../../_lib/auth.js';
import { deleteTrader } from '../../../_lib/admin-delete.js';

// POST /api/admin/users/delete { ids: [...] }  (admin only) -> bulk delete, max 200 per call.
export async function onRequestPost({ request, env }) {
  try {
    const me = await getUserFromRequest(request, env);
    if (!me) return json({ error: 'Not authenticated' }, { status: 401 });
    if (!isAdminUser(me, env)) return json({ error: 'Sirf admin.' }, { status: 403 });
    await ensureSchema(env);
    const body = await readJson(request);
    const ids = [...new Set((Array.isArray(body?.ids) ? body.ids : []).map(String))].slice(0, 200);
    if (!ids.length) return json({ error: 'Koi trader select nahi kiya.' }, { status: 400 });
    const results = [];
    for (const id of ids) results.push(await deleteTrader(env, me, id));
    return json({ deleted: results.filter(r => r.ok).length, failed: results.filter(r => !r.ok), images: results.reduce((a, r) => a + (r.images || 0), 0) });
  } catch (e) {
    console.error('admin bulk delete error', e);
    return json({ error: 'Delete nahi hua.' }, { status: 500 });
  }
}

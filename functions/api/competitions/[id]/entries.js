import { getUserFromRequest, json, ensureSchema, isAdminUser } from '../../../_lib/auth.js';
import { clapMap, feedRow, userNames, FEED_PAGE } from '../../../_lib/competition.js';

// GET /api/competitions/<id>/entries?offset=40 -> next page of the anonymous feed ("Aur dikhao").
// Entries are never posted here: a trade enters the competition when the trader saves it
// in the journal with Sir's strategy selected (see _lib/competition.js -> syncUserEntries).
export async function onRequestGet({ request, env, params }) {
  try {
    const user = await getUserFromRequest(request, env);
    if (!user) return json({ error: 'Not authenticated' }, { status: 401 });
    await ensureSchema(env);
    const id = String(params.id), admin = isAdminUser(user, env);
    const offset = Math.max(0, Math.min(5000, parseInt(new URL(request.url).searchParams.get('offset') || '0', 10) || 0));
    const where = admin ? '' : `AND (status = 'ok' OR user_id = ?)`;
    const q = env.DB.prepare(`SELECT * FROM competition_entries WHERE competition_id = ? ${where} ORDER BY created_at DESC, id LIMIT ${FEED_PAGE + 1} OFFSET ?`);
    const { results } = await (admin ? q.bind(id, offset) : q.bind(id, user.id, offset)).all();
    const names = admin ? await userNames(env) : {}, claps = await clapMap(env, id, user.id);
    return json({ feed: results.slice(0, FEED_PAGE).map(r => feedRow(r, user.id, admin, names, claps)), feedMore: results.length > FEED_PAGE });
  } catch (e) { console.error('comp feed', e); return json({ error: 'Feed load nahi hua.' }, { status: 500 }); }
}

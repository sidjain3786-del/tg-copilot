import { getUserFromRequest, json } from '../_lib/auth.js';

export async function onRequestGet({ request, env }) {
  const user = await getUserFromRequest(request, env);
  if (!user) return json({ error: 'Not authenticated' }, { status: 401 });

  const row = await env.DB.prepare(
    'SELECT trades, notes, custom_strategies FROM user_data WHERE user_id = ?'
  ).bind(user.id).first();

  return json({
    trades: row ? JSON.parse(row.trades) : [],
    notes: row ? JSON.parse(row.notes) : [],
    customStrategies: row ? JSON.parse(row.custom_strategies) : []
  });
}

export async function onRequestPost({ request, env }) {
  const user = await getUserFromRequest(request, env);
  if (!user) return json({ error: 'Not authenticated' }, { status: 401 });

  const { trades, notes, customStrategies } = await request.json();
  const updatedAt = new Date().toISOString();

  await env.DB.prepare(`
    INSERT INTO user_data (user_id, trades, notes, custom_strategies, updated_at)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(user_id) DO UPDATE SET
      trades = excluded.trades,
      notes = excluded.notes,
      custom_strategies = excluded.custom_strategies,
      updated_at = excluded.updated_at
  `).bind(
    user.id,
    JSON.stringify(trades || []),
    JSON.stringify(notes || []),
    JSON.stringify(customStrategies || []),
    updatedAt
  ).run();

  return json({ ok: true });
}

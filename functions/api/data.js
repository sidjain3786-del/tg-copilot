import { getUserFromRequest, json, readJson, parseColumn, ensureSchema, touchActivity } from '../_lib/auth.js';

const LEGACY_DEFAULT_STRATEGY_NAMES = new Set([
  'Asian High/Low Liquidity Sweep (AMD)',
  'ICT Fair Value Gap (FVG) + Breaker',
  'Order Block (OB) Retest with Displacement'
]);

// D1 rejects any single string/row over 2,000,000 bytes. Stay safely below it
// and return a clear message instead of a raw database error.
const MAX_COLUMN_BYTES = 1_900_000;
const byteLength = s => new TextEncoder().encode(s).length;

function cleanStrategies(value) {
  const parsed = Array.isArray(value) ? value : parseColumn(value || '[]', []);
  return (Array.isArray(parsed) ? parsed : []).filter(s => {
    const name = typeof s === 'string' ? s : s?.name;
    return name && !LEGACY_DEFAULT_STRATEGY_NAMES.has(String(name).trim());
  });
}

export async function onRequestGet({ request, env }) {
  try {
    const user = await getUserFromRequest(request, env);
    if (!user) return json({ error: 'Not authenticated' }, { status: 401 });
    await ensureSchema(env);

    const row = await env.DB.prepare('SELECT trades, notes, custom_strategies FROM user_data WHERE user_id = ?').bind(user.id).first();
    const sessionRow = await env.DB.prepare('SELECT notes FROM user_session_notes WHERE user_id = ?').bind(user.id).first();

    const trades = row ? parseColumn(row.trades, []) : [];
    const notes = row ? parseColumn(row.notes, []) : [];
    const customStrategies = cleanStrategies(row?.custom_strategies);
    const sessionNotes = parseColumn(sessionRow?.notes || '{}', {});
    const warnings = [];
    if (row && !Array.isArray(parseColumn(row.trades, null))) warnings.push('Stored trades could not be read.');
    if (row && !Array.isArray(parseColumn(row.notes, null))) warnings.push('Stored notes could not be read.');

    // Clean legacy demo strategies from D1 while preserving user-created ones.
    if (row && JSON.stringify(customStrategies) !== row.custom_strategies) {
      await env.DB.prepare('UPDATE user_data SET custom_strategies = ?, updated_at = ? WHERE user_id = ?')
        .bind(JSON.stringify(customStrategies), new Date().toISOString(), user.id).run();
    }

    return json({
      trades: Array.isArray(trades) ? trades : [],
      notes: Array.isArray(notes) ? notes : [],
      customStrategies,
      sessionNotes: sessionNotes && typeof sessionNotes === 'object' && !Array.isArray(sessionNotes) ? sessionNotes : {},
      ...(warnings.length ? { warnings } : {})
    });
  } catch (e) {
    console.error('data GET error', e);
    return json({ error: 'Could not load your journal. Please refresh.' }, { status: 500 });
  }
}

export async function onRequestPost({ request, env }) {
  try {
    const user = await getUserFromRequest(request, env);
    if (!user) return json({ error: 'Not authenticated' }, { status: 401 });

    const body = await readJson(request);
    if (!body) return json({ error: 'Invalid data sent. Please refresh and try again.' }, { status: 400 });
    await ensureSchema(env);

    // Only fields that are actually present get written. An older cached client
    // that sends just { trades } can no longer wipe notes, strategies or session notes.
    const updates = {};
    if (body.trades !== undefined) {
      if (!Array.isArray(body.trades)) return json({ error: 'trades must be a list.' }, { status: 400 });
      updates.trades = JSON.stringify(body.trades);
    }
    if (body.notes !== undefined) {
      if (!Array.isArray(body.notes)) return json({ error: 'notes must be a list.' }, { status: 400 });
      updates.notes = JSON.stringify(body.notes);
    }
    if (body.customStrategies !== undefined) {
      if (!Array.isArray(body.customStrategies)) return json({ error: 'customStrategies must be a list.' }, { status: 400 });
      updates.custom_strategies = JSON.stringify(cleanStrategies(body.customStrategies));
    }
    let sessionNotesJson = null;
    if (body.sessionNotes !== undefined) {
      if (!body.sessionNotes || typeof body.sessionNotes !== 'object' || Array.isArray(body.sessionNotes)) {
        return json({ error: 'sessionNotes must be an object.' }, { status: 400 });
      }
      sessionNotesJson = JSON.stringify(body.sessionNotes);
    }

    const rowBytes = Object.values(updates).reduce((a, v) => a + byteLength(v), 0);
    for (const [k, v] of Object.entries(updates)) {
      if (byteLength(v) > MAX_COLUMN_BYTES || rowBytes > MAX_COLUMN_BYTES) {
        return json({
          error: `Journal data too large (${(rowBytes / 1e6).toFixed(2)} MB). Chart images must be uploaded to image storage — check that the IMAGES R2 binding is set up.`,
          field: k
        }, { status: 413 });
      }
    }

    const updatedAt = new Date().toISOString();
    const cols = Object.keys(updates);
    if (cols.length) {
      const existing = await env.DB.prepare('SELECT user_id FROM user_data WHERE user_id = ?').bind(user.id).first();
      if (existing) {
        await env.DB.prepare(`UPDATE user_data SET ${cols.map(c => `${c} = ?`).join(', ')}, updated_at = ? WHERE user_id = ?`)
          .bind(...cols.map(c => updates[c]), updatedAt, user.id).run();
      } else {
        await env.DB.prepare('INSERT INTO user_data (user_id, trades, notes, custom_strategies, updated_at) VALUES (?, ?, ?, ?, ?)')
          .bind(user.id, updates.trades ?? '[]', updates.notes ?? '[]', updates.custom_strategies ?? '[]', updatedAt).run();
      }
    }

    if (sessionNotesJson !== null) {
      await env.DB.prepare('INSERT INTO user_session_notes (user_id, notes, updated_at) VALUES (?, ?, ?) ON CONFLICT(user_id) DO UPDATE SET notes = excluded.notes, updated_at = excluded.updated_at')
        .bind(user.id, sessionNotesJson, updatedAt).run();
    }

    await touchActivity(env, user.id, 'save');
    return json({ ok: true, updatedAt });
  } catch (e) {
    console.error('data POST error', e);
    return json({ error: 'Save failed on the server. Please try again.' }, { status: 500 });
  }
}

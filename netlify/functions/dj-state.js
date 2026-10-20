// dj-state.js — load or save a DJ's full state (pool, history, flagged, denied, settings)
// GET  → returns all state for the authenticated DJ
// POST → saves/replaces state for the authenticated DJ
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

function authHeaders(token) {
  return { 'apikey': SUPABASE_ANON_KEY, 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' };
}

async function getUserId(token) {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: { 'apikey': SUPABASE_ANON_KEY, 'Authorization': `Bearer ${token}` },
  });
  if (!res.ok) return null;
  const data = await res.json();
  return data.id || null;
}

exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Content-Type': 'application/json',
  };
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers, body: '' };

  const token = (event.headers['authorization'] || '').replace('Bearer ', '').trim();
  if (!token) return { statusCode: 401, headers, body: JSON.stringify({ error: 'Not authenticated' }) };

  const userId = await getUserId(token);
  if (!userId) return { statusCode: 401, headers, body: JSON.stringify({ error: 'Invalid token' }) };

  const ah = authHeaders(token);

  // ── GET: load all state ──
  if (event.httpMethod === 'GET') {
    const [poolRes, histRes, flagRes, denRes, setRes] = await Promise.all([
      fetch(`${SUPABASE_URL}/rest/v1/dj_pool?dj_id=eq.${userId}&order=added_at.asc`, { headers: ah }),
      fetch(`${SUPABASE_URL}/rest/v1/dj_history?dj_id=eq.${userId}&order=played_at.asc`, { headers: ah }),
      fetch(`${SUPABASE_URL}/rest/v1/dj_flagged?dj_id=eq.${userId}&order=added_at.asc`, { headers: ah }),
      fetch(`${SUPABASE_URL}/rest/v1/dj_denied?dj_id=eq.${userId}&order=added_at.asc`, { headers: ah }),
      fetch(`${SUPABASE_URL}/rest/v1/dj_settings?dj_id=eq.${userId}`, { headers: ah }),
    ]);

    const [pool, history, flagged, denied, settings] = await Promise.all([
      poolRes.json(), histRes.json(), flagRes.json(), denRes.json(), setRes.json(),
    ]);

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        pool: pool || [],
        history: history || [],
        flagged: flagged || [],
        denied: denied || [],
        settings: settings[0] || { filter_mode: 'somegrime', vibe_prompt: '', event_type: 'mixed' },
      }),
    };
  }

  // ── POST: save full state (replaces everything) ──
  if (event.httpMethod === 'POST') {
    let body;
    try { body = JSON.parse(event.body || '{}'); } catch { return { statusCode: 400, headers, body: JSON.stringify({ error: 'Invalid JSON' }) }; }

    const { pool = [], history = [], flagged = [], denied = [], settings = {} } = body;
    const svcH = { 'apikey': SUPABASE_SERVICE_KEY, 'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`, 'Content-Type': 'application/json' };

    // Upsert rows by spotify_id (or song+artist for rows without spotify_id).
    // We no longer DELETE+reinsert — that pattern wiped auto-scanned songs
    // that landed in Supabase between the last loadState and this save.
    // Instead: upsert rows the client knows about, leaving any rows it doesn't
    // know about (freshly auto-scanned) untouched.
    // Rows the user explicitly deleted are handled by passing their ids in
    // the separate `deleted_ids` payload fields.

    const { deleted_pool = [], deleted_flagged = [], deleted_denied = [], deleted_history = [] } = body;

    // Delete only the rows explicitly removed by the user
    const deleteById = async (table, ids) => {
      if (!ids.length) return;
      // Supabase: DELETE /rest/v1/table?id=in.(id1,id2,...)
      await fetch(`${SUPABASE_URL}/rest/v1/${table}?id=in.(${ids.join(',')})&dj_id=eq.${userId}`, {
        method: 'DELETE', headers: svcH,
      });
    };

    await Promise.all([
      deleteById('dj_pool', deleted_pool),
      deleteById('dj_history', deleted_history),
      deleteById('dj_flagged', deleted_flagged),
      deleteById('dj_denied', deleted_denied),
    ]);

    // Upsert known rows (on-conflict merge by id).
    // Rows with id → update in place. Rows without id → insert as new rows.
    // JSON.stringify automatically strips undefined, so { id: undefined } serialises without id.
    const toUpsert = (rows) => rows
      .filter(r => r && r.song)
      .map(r => {
        const row = { ...r, dj_id: userId };
        if (row.id === undefined || row.id === null) delete row.id;
        return row;
      });

    const upsertTable = async (table, rows) => {
      if (!rows.length) return;
      const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}?on_conflict=id`, {
        method: 'POST',
        headers: { ...svcH, 'Prefer': 'resolution=merge-duplicates,return=minimal' },
        body: JSON.stringify(rows),
      });
      if (!res.ok) {
        const err = await res.text();
        console.error(`[dj-state] upsert ${table} failed: ${res.status} — ${err}`);
      }
    };

    await Promise.all([
      upsertTable('dj_pool', toUpsert(pool)),
      upsertTable('dj_history', toUpsert(history)),
      upsertTable('dj_flagged', toUpsert(flagged)),
      upsertTable('dj_denied', toUpsert(denied)),
    ]);

    // Upsert settings
    await fetch(`${SUPABASE_URL}/rest/v1/dj_settings`, {
      method: 'POST',
      headers: { ...svcH, 'Prefer': 'resolution=merge-duplicates' },
      body: JSON.stringify({ dj_id: userId, ...settings, updated_at: new Date().toISOString() }),
    });

    return { statusCode: 200, headers, body: JSON.stringify({ ok: true }) };
  }

  return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };
};

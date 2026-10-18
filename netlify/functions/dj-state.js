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

    // Delete existing rows for this DJ, then reinsert
    await Promise.all([
      fetch(`${SUPABASE_URL}/rest/v1/dj_pool?dj_id=eq.${userId}`, { method: 'DELETE', headers: svcH }),
      fetch(`${SUPABASE_URL}/rest/v1/dj_history?dj_id=eq.${userId}`, { method: 'DELETE', headers: svcH }),
      fetch(`${SUPABASE_URL}/rest/v1/dj_flagged?dj_id=eq.${userId}`, { method: 'DELETE', headers: svcH }),
      fetch(`${SUPABASE_URL}/rest/v1/dj_denied?dj_id=eq.${userId}`, { method: 'DELETE', headers: svcH }),
    ]);

    const toInsert = (rows, extra = {}) => rows.map(r => ({ ...extra, dj_id: userId, ...r, id: undefined }));

    await Promise.all([
      pool.length && fetch(`${SUPABASE_URL}/rest/v1/dj_pool`, { method: 'POST', headers: { ...svcH, 'Prefer': 'return=minimal' }, body: JSON.stringify(toInsert(pool)) }),
      history.length && fetch(`${SUPABASE_URL}/rest/v1/dj_history`, { method: 'POST', headers: { ...svcH, 'Prefer': 'return=minimal' }, body: JSON.stringify(toInsert(history)) }),
      flagged.length && fetch(`${SUPABASE_URL}/rest/v1/dj_flagged`, { method: 'POST', headers: { ...svcH, 'Prefer': 'return=minimal' }, body: JSON.stringify(toInsert(flagged)) }),
      denied.length && fetch(`${SUPABASE_URL}/rest/v1/dj_denied`, { method: 'POST', headers: { ...svcH, 'Prefer': 'return=minimal' }, body: JSON.stringify(toInsert(denied)) }),
    ].filter(Boolean));

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

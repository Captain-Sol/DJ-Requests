// dj-counts.js — lightweight check of how many songs the DJ has in each list.
// The picker polls this every 10 s; when anything changes it reloads full state,
// so the pool / flagged / denied badges always match what's in Supabase.
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;

async function getUserId(token) {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: { 'apikey': SUPABASE_ANON_KEY, 'Authorization': `Bearer ${token}` },
  });
  if (!res.ok) return null;
  const data = await res.json();
  return data.id || null;
}

// Ask Supabase for a row count and the newest row's timestamp, without downloading rows.
async function tableInfo(table, filter, tsCol, ah) {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/${table}?${filter}&select=${tsCol}&order=${tsCol}.desc&limit=1`,
    { headers: { ...ah, 'Prefer': 'count=exact' } }
  );
  if (!res.ok) throw new Error(`${table} ${res.status}`);
  const range = res.headers.get('content-range') || '';   // e.g. "0-0/12" or "*/0"
  const total = parseInt(range.split('/')[1], 10);
  const rows = await res.json();
  return { count: Number.isFinite(total) ? total : 0, latest: rows[0]?.[tsCol] || null };
}

exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Content-Type': 'application/json',
    'Cache-Control': 'no-store',
  };
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers, body: '' };
  if (event.httpMethod !== 'GET') return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };

  const token = (event.headers['authorization'] || '').replace('Bearer ', '').trim();
  if (!token) return { statusCode: 401, headers, body: JSON.stringify({ error: 'Not authenticated' }) };
  const userId = await getUserId(token);
  if (!userId) return { statusCode: 401, headers, body: JSON.stringify({ error: 'Invalid token' }) };

  const ah = { 'apikey': SUPABASE_ANON_KEY, 'Authorization': `Bearer ${token}` };
  const mine = `dj_id=eq.${userId}`;

  try {
    const [pool, flagged, denied, pending] = await Promise.all([
      tableInfo('dj_pool', mine, 'added_at', ah),
      tableInfo('dj_flagged', mine, 'added_at', ah),
      tableInfo('dj_denied', mine, 'added_at', ah),
      tableInfo('dj_requests', `${mine}&status=eq.pending`, 'submitted_at', ah),
    ]);
    return { statusCode: 200, headers, body: JSON.stringify({ pool, flagged, denied, pending }) };
  } catch (e) {
    return { statusCode: 502, headers, body: JSON.stringify({ error: String(e.message || e) }) };
  }
};

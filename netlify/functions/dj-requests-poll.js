// dj-requests-poll.js — DJ polls for new pending guest requests
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;

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

  const ah = { 'apikey': SUPABASE_ANON_KEY, 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' };

  if (event.httpMethod === 'GET') {
    // Return pending requests for this DJ (RLS enforces ownership)
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/dj_requests?status=eq.pending&order=submitted_at.asc&select=*`,
      { headers: ah }
    );
    const data = await res.json();
    return { statusCode: 200, headers, body: JSON.stringify({ requests: Array.isArray(data) ? data : [] }) };
  }

  if (event.httpMethod === 'POST') {
    // Update a request status (approve / deny)
    let body;
    try { body = JSON.parse(event.body || '{}'); } catch { return { statusCode: 400, headers, body: JSON.stringify({ error: 'Invalid JSON' }) }; }
    const { id, status } = body;
    if (!id || !['approved', 'denied', 'pending'].includes(status)) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'id and valid status required' }) };
    }
    const res = await fetch(`${SUPABASE_URL}/rest/v1/dj_requests?id=eq.${id}`, {
      method: 'PATCH',
      headers: { ...ah, 'Prefer': 'return=minimal' },
      body: JSON.stringify({ status }),
    });
    if (!res.ok) {
      const err = await res.text();
      return { statusCode: 500, headers, body: JSON.stringify({ error: err }) };
    }
    return { statusCode: 200, headers, body: JSON.stringify({ ok: true }) };
  }

  return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };
};

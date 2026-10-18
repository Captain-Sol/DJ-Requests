// admin-list-djs.js — list all DJ accounts (admin only)
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Content-Type': 'application/json',
  };
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers, body: '' };
  if (event.httpMethod !== 'GET') return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };

  const authHeader = event.headers['authorization'] || '';
  const callerToken = authHeader.replace('Bearer ', '').trim();
  if (!callerToken) return { statusCode: 401, headers, body: JSON.stringify({ error: 'Not authenticated' }) };

  // Resolve caller identity then verify admin role
  const meRes = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: { 'apikey': SUPABASE_SERVICE_KEY, 'Authorization': `Bearer ${callerToken}` },
  });
  if (!meRes.ok) return { statusCode: 401, headers, body: JSON.stringify({ error: 'Invalid token' }) };
  const me = await meRes.json();

  const profileCheck = await fetch(`${SUPABASE_URL}/rest/v1/dj_profiles?id=eq.${me.id}&select=role`, {
    headers: { 'apikey': SUPABASE_SERVICE_KEY, 'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}` },
  });
  const meData = await profileCheck.json();
  if (!meData[0] || meData[0].role !== 'admin') {
    return { statusCode: 403, headers, body: JSON.stringify({ error: 'Admin access required' }) };
  }

  // Fetch all profiles + request counts
  const profilesRes = await fetch(`${SUPABASE_URL}/rest/v1/dj_profiles?select=*&order=created_at.asc`, {
    headers: { 'apikey': SUPABASE_SERVICE_KEY, 'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}` },
  });
  const profiles = await profilesRes.json();

  // For each DJ, get pending request count
  const enriched = await Promise.all(profiles.map(async (dj) => {
    const reqRes = await fetch(
      `${SUPABASE_URL}/rest/v1/dj_requests?dj_id=eq.${dj.id}&status=eq.pending&select=id`,
      { headers: { 'apikey': SUPABASE_SERVICE_KEY, 'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}` } }
    );
    const reqs = await reqRes.json();
    return { ...dj, pending_requests: Array.isArray(reqs) ? reqs.length : 0 };
  }));

  return { statusCode: 200, headers, body: JSON.stringify({ djs: enriched }) };
};

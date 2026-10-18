// admin-repair-profile.js — create a missing dj_profiles row for an existing auth user
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Content-Type': 'application/json',
  };
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers, body: '' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };

  // Verify admin token
  const auth = event.headers['authorization'] || '';
  const token = auth.replace('Bearer ', '').trim();
  if (!token) return { statusCode: 401, headers, body: JSON.stringify({ error: 'Unauthorized' }) };

  const meRes = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: { 'apikey': SUPABASE_SERVICE_KEY, 'Authorization': `Bearer ${token}` },
  });
  if (!meRes.ok) return { statusCode: 401, headers, body: JSON.stringify({ error: 'Invalid token' }) };
  const me = await meRes.json();

  const profileCheck = await fetch(`${SUPABASE_URL}/rest/v1/dj_profiles?id=eq.${me.id}&select=role`, {
    headers: { 'apikey': SUPABASE_SERVICE_KEY, 'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}` },
  });
  const myProfile = await profileCheck.json();
  if (!myProfile[0] || myProfile[0].role !== 'admin') {
    return { statusCode: 403, headers, body: JSON.stringify({ error: 'Admin only' }) };
  }

  let body;
  try { body = JSON.parse(event.body || '{}'); } catch {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Invalid JSON' }) };
  }

  const { user_id, display_name, slug } = body;
  if (!user_id || !display_name || !slug) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'user_id, display_name, and slug are required.' }) };
  }

  // Check slug not already taken by someone else
  const slugCheck = await fetch(
    `${SUPABASE_URL}/rest/v1/dj_profiles?slug=eq.${encodeURIComponent(slug)}&id=neq.${user_id}&select=slug`,
    { headers: { 'apikey': SUPABASE_SERVICE_KEY, 'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}` } }
  );
  const existing = await slugCheck.json();
  if (Array.isArray(existing) && existing.length > 0) {
    return { statusCode: 409, headers, body: JSON.stringify({ error: 'That slug is already taken.' }) };
  }

  // Upsert profile row
  const res = await fetch(`${SUPABASE_URL}/rest/v1/dj_profiles`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'apikey': SUPABASE_SERVICE_KEY,
      'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
      'Prefer': 'resolution=merge-duplicates,return=minimal',
    },
    body: JSON.stringify({ id: user_id, display_name: display_name.trim(), slug: slug.trim(), role: 'dj' }),
  });

  if (!res.ok) {
    const err = await res.text();
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'Profile upsert failed: ' + err }) };
  }

  return { statusCode: 200, headers, body: JSON.stringify({ ok: true }) };
};

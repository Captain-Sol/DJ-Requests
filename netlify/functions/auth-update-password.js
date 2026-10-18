// auth-update-password.js — update password using a recovery access token
const SUPABASE_URL = process.env.SUPABASE_URL;

exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Content-Type': 'application/json',
  };
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers, body: '' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };

  const auth = event.headers['authorization'] || '';
  const token = auth.replace('Bearer ', '').trim();
  if (!token) return { statusCode: 401, headers, body: JSON.stringify({ error: 'No token provided.' }) };

  let body;
  try { body = JSON.parse(event.body || '{}'); } catch {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Invalid JSON' }) };
  }
  const { password } = body;
  if (!password || password.length < 6) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Password must be at least 6 characters.' }) };
  }

  // Use the recovery token to update the password
  const res = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      'apikey': process.env.SUPABASE_ANON_KEY,
      'Authorization': `Bearer ${token}`,
    },
    body: JSON.stringify({ password }),
  });

  const data = await res.json();
  if (!res.ok) {
    return { statusCode: res.status, headers, body: JSON.stringify({ error: data.message || data.error_description || 'Failed to update password.' }) };
  }

  // Clear the must_reset_password flag now that they've set their own password
  await fetch(`${SUPABASE_URL}/rest/v1/dj_profiles?id=eq.${data.id}`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      'apikey': process.env.SUPABASE_SERVICE_KEY,
      'Authorization': `Bearer ${process.env.SUPABASE_SERVICE_KEY}`,
    },
    body: JSON.stringify({ must_reset_password: false }),
  }).catch(() => {});

  return {
    statusCode: 200,
    headers,
    body: JSON.stringify({ ok: true, access_token: token }),
  };
};

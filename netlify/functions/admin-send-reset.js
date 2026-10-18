// admin-send-reset.js — admin triggers a password reset email for a DJ
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;
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

  // Verify admin
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
  const { user_id } = body;
  if (!user_id) return { statusCode: 400, headers, body: JSON.stringify({ error: 'user_id required' }) };

  // Look up the user's email
  const userRes = await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${user_id}`, {
    headers: { 'apikey': SUPABASE_SERVICE_KEY, 'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}` },
  });
  if (!userRes.ok) return { statusCode: 404, headers, body: JSON.stringify({ error: 'User not found' }) };
  const user = await userRes.json();

  // Also set must_reset_password = true so login stays blocked until they reset
  await fetch(`${SUPABASE_URL}/rest/v1/dj_profiles?id=eq.${user_id}`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      'apikey': SUPABASE_SERVICE_KEY,
      'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
    },
    body: JSON.stringify({ must_reset_password: true }),
  }).catch(() => {});

  // Send reset email
  await fetch(`${SUPABASE_URL}/auth/v1/recover`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'apikey': SUPABASE_ANON_KEY },
    body: JSON.stringify({
      email: user.email,
      redirect_to: 'https://dj-you.netlify.app/picker.html',
    }),
  });

  return { statusCode: 200, headers, body: JSON.stringify({ ok: true }) };
};

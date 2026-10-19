// auth-token-exchange.js — given a valid Supabase access_token, return a full session object.
// Used by picker.html after a magic-link sign-in (the token arrives in the URL hash).
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json',
  };
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers, body: '' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };

  let body;
  try { body = JSON.parse(event.body || '{}'); } catch {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Invalid JSON' }) };
  }

  const { access_token, refresh_token } = body;
  if (!access_token) return { statusCode: 400, headers, body: JSON.stringify({ error: 'access_token required' }) };

  // Validate the token and get user info
  const userRes = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: { 'apikey': SUPABASE_SERVICE_KEY, 'Authorization': `Bearer ${access_token}` },
  });
  if (!userRes.ok) {
    return { statusCode: 401, headers, body: JSON.stringify({ error: 'Invalid or expired token' }) };
  }
  const user = await userRes.json();

  // Fetch the DJ's profile
  const profileRes = await fetch(`${SUPABASE_URL}/rest/v1/dj_profiles?id=eq.${user.id}&select=*`, {
    headers: { 'apikey': SUPABASE_SERVICE_KEY, 'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}` },
  });
  const profiles = await profileRes.json();
  const profile = profiles[0] || null;

  return {
    statusCode: 200,
    headers,
    body: JSON.stringify({
      access_token,
      refresh_token: refresh_token || null,
      user: { id: user.id, email: user.email },
      profile,
    }),
  };
};

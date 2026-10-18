// auth-login.js — sign in with email + password, return session token
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;

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
  try { body = JSON.parse(event.body || '{}'); } catch { return { statusCode: 400, headers, body: JSON.stringify({ error: 'Invalid JSON' }) }; }

  const { email, password } = body;
  if (!email || !password) return { statusCode: 400, headers, body: JSON.stringify({ error: 'Email and password required' }) };

  const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'apikey': SUPABASE_ANON_KEY },
    body: JSON.stringify({ email, password }),
  });

  const data = await res.json();
  if (!res.ok) return { statusCode: 401, headers, body: JSON.stringify({ error: data.error_description || data.msg || 'Login failed' }) };

  // Fetch the DJ's profile (slug, display name, role)
  const profileRes = await fetch(`${SUPABASE_URL}/rest/v1/dj_profiles?id=eq.${data.user.id}&select=*`, {
    headers: { 'apikey': SUPABASE_ANON_KEY, 'Authorization': `Bearer ${data.access_token}` },
  });
  const profiles = await profileRes.json();
  const profile = profiles[0] || null;

  // If account requires a password reset, send a reset email and block login
  if (profile && profile.must_reset_password) {
    // Fire reset email in background (don't await — just kick it off)
    fetch(`${SUPABASE_URL}/auth/v1/recover`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'apikey': SUPABASE_ANON_KEY },
      body: JSON.stringify({
        email: data.user.email,
        redirect_to: 'https://dj-you.netlify.app/picker.html',
      }),
    }).catch(() => {});
    return {
      statusCode: 403,
      headers,
      body: JSON.stringify({ error: 'must_reset_password', email: data.user.email }),
    };
  }

  return {
    statusCode: 200,
    headers,
    body: JSON.stringify({
      access_token: data.access_token,
      refresh_token: data.refresh_token,
      expires_at: data.expires_at,
      user: { id: data.user.id, email: data.user.email },
      profile,
    }),
  };
};

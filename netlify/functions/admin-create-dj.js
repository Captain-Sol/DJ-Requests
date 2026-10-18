// admin-create-dj.js — admin creates a new DJ account
// Requires a valid admin access token in Authorization header
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

  // Verify caller is an admin
  const authHeader = event.headers['authorization'] || '';
  const callerToken = authHeader.replace('Bearer ', '').trim();
  if (!callerToken) return { statusCode: 401, headers, body: JSON.stringify({ error: 'Not authenticated' }) };

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

  let body;
  try { body = JSON.parse(event.body || '{}'); } catch { return { statusCode: 400, headers, body: JSON.stringify({ error: 'Invalid JSON' }) }; }

  const { email, password, display_name, slug } = body;
  if (!email || !password || !display_name || !slug) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'email, password, display_name, and slug are required' }) };
  }

  // Create auth user via service role (bypasses email confirmation)
  const createRes = await fetch(`${SUPABASE_URL}/auth/v1/admin/users`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'apikey': SUPABASE_SERVICE_KEY,
      'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
    },
    body: JSON.stringify({ email, password, email_confirm: true }),
  });
  const createData = await createRes.json();
  if (!createRes.ok) return { statusCode: 400, headers, body: JSON.stringify({ error: createData.msg || createData.error || 'Failed to create user' }) };

  const userId = createData.id;

  // Insert DJ profile
  const profileRes = await fetch(`${SUPABASE_URL}/rest/v1/dj_profiles`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'apikey': SUPABASE_SERVICE_KEY,
      'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
      'Prefer': 'return=representation',
    },
    body: JSON.stringify({ id: userId, display_name, slug: slug.toLowerCase().replace(/[^a-z0-9-]/g, ''), role: 'dj', must_reset_password: true }),
  });

  // Insert default settings row
  await fetch(`${SUPABASE_URL}/rest/v1/dj_settings`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'apikey': SUPABASE_SERVICE_KEY,
      'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
    },
    body: JSON.stringify({ dj_id: userId, filter_mode: 'somegrime', vibe_prompt: '', event_type: 'mixed' }),
  });

  const profileData = await profileRes.json();
  return { statusCode: 200, headers, body: JSON.stringify({ ok: true, user_id: userId, profile: profileData[0] }) };
};

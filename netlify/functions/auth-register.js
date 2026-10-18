// auth-register.js — create a new DJ account with invite code + email confirmation
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
const DJ_INVITE_CODE = process.env.DJ_INVITE_CODE || '';

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

  const { email, password, display_name, slug, invite_code } = body;

  // Validate fields
  if (!email || !password || !display_name || !slug || !invite_code) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'All fields are required.' }) };
  }

  // Check invite code
  if (!DJ_INVITE_CODE) {
    return { statusCode: 503, headers, body: JSON.stringify({ error: 'Registration is not configured yet.' }) };
  }
  if (invite_code.trim() !== DJ_INVITE_CODE.trim()) {
    return { statusCode: 403, headers, body: JSON.stringify({ error: 'Invalid invite code.' }) };
  }

  // Validate slug format
  if (!/^[a-z0-9_-]+$/.test(slug)) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Slug can only contain lowercase letters, numbers, hyphens, and underscores.' }) };
  }

  // Check slug is not already taken
  const slugCheck = await fetch(
    `${SUPABASE_URL}/rest/v1/dj_profiles?slug=eq.${encodeURIComponent(slug)}&select=slug`,
    { headers: { 'apikey': SUPABASE_SERVICE_KEY, 'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}` } }
  );
  const existing = await slugCheck.json();
  if (Array.isArray(existing) && existing.length > 0) {
    return { statusCode: 409, headers, body: JSON.stringify({ error: 'That DJ name/slug is already taken.' }) };
  }

  // Sign up via Supabase Auth (sends confirmation email automatically)
  const signupRes = await fetch(`${SUPABASE_URL}/auth/v1/signup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'apikey': SUPABASE_ANON_KEY },
    body: JSON.stringify({ email, password }),
  });
  const signupData = await signupRes.json();

  if (!signupRes.ok) {
    const msg = signupData.msg || signupData.error_description || signupData.error || 'Registration failed.';
    return { statusCode: 400, headers, body: JSON.stringify({ error: msg }) };
  }

  const userId = signupData.user?.id || signupData.id;
  if (!userId) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'Could not get user ID from signup response.' }) };
  }

  // Insert dj_profiles row using service key (user can't do it yet — not confirmed)
  const profileRes = await fetch(`${SUPABASE_URL}/rest/v1/dj_profiles`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'apikey': SUPABASE_SERVICE_KEY,
      'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
      'Prefer': 'return=minimal',
    },
    body: JSON.stringify({ id: userId, display_name: display_name.trim(), slug: slug.trim(), role: 'dj' }),
  });

  if (!profileRes.ok) {
    const err = await profileRes.text();
    // If profile insert fails, still return success for auth — user can contact admin
    console.error('Profile insert failed:', err);
  }

  return {
    statusCode: 200,
    headers,
    body: JSON.stringify({
      ok: true,
      message: 'Account created! Check your email to confirm your address before signing in.',
    }),
  };
};

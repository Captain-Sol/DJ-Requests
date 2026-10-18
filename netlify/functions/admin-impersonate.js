// admin-impersonate.js — generate a one-time magic link so admin can log in as any DJ
// Returns a short-lived sign-in URL that opens picker.html as that user in a new tab.
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

  // Verify caller is admin
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

  // Look up the target user's email (required by generate-link)
  const userRes = await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${user_id}`, {
    headers: { 'apikey': SUPABASE_SERVICE_KEY, 'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}` },
  });
  if (!userRes.ok) {
    const err = await userRes.text();
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'Could not fetch target user', detail: err }) };
  }
  const targetUser = await userRes.json();
  const targetEmail = targetUser.email;
  if (!targetEmail) return { statusCode: 400, headers, body: JSON.stringify({ error: 'Target user has no email' }) };

  // Generate a magic link for the target user
  const linkRes = await fetch(`${SUPABASE_URL}/auth/v1/admin/generate_link`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'apikey': SUPABASE_SERVICE_KEY,
      'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
    },
    body: JSON.stringify({
      type: 'magiclink',
      email: targetEmail,
      redirect_to: 'https://dj-you.netlify.app/picker.html',
    }),
  });

  if (!linkRes.ok) {
    const err = await linkRes.text();
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'Could not generate magic link', detail: err }) };
  }

  const linkData = await linkRes.json();
  // The action_link is the one-time URL that signs the user in
  const actionLink = linkData.action_link || linkData.properties?.action_link;
  if (!actionLink) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'No action_link in response', raw: linkData }) };
  }

  return { statusCode: 200, headers, body: JSON.stringify({ ok: true, url: actionLink }) };
};

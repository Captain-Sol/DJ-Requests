// admin-list-auth-users.js — list all auth users and cross-reference with dj_profiles
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Content-Type': 'application/json',
  };
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers, body: '' };

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

  // Get all auth users
  const usersRes = await fetch(`${SUPABASE_URL}/auth/v1/admin/users?per_page=200`, {
    headers: { 'apikey': SUPABASE_SERVICE_KEY, 'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}` },
  });
  const usersData = await usersRes.json();
  const authUsers = usersData.users || [];

  // Get all profiles
  const profilesRes = await fetch(`${SUPABASE_URL}/rest/v1/dj_profiles?select=*`, {
    headers: { 'apikey': SUPABASE_SERVICE_KEY, 'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}` },
  });
  const profiles = await profilesRes.json();
  const profileMap = {};
  profiles.forEach(p => { profileMap[p.id] = p; });

  // Cross-reference
  const users = authUsers.map(u => ({
    id: u.id,
    email: u.email,
    confirmed: !!u.email_confirmed_at,
    created_at: u.created_at,
    has_profile: !!profileMap[u.id],
    profile: profileMap[u.id] || null,
  }));

  return { statusCode: 200, headers, body: JSON.stringify({ users }) };
};

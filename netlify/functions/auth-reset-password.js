// auth-reset-password.js — send a password reset email via Supabase
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
  try { body = JSON.parse(event.body || '{}'); } catch {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Invalid JSON' }) };
  }

  const { email } = body;
  if (!email) return { statusCode: 400, headers, body: JSON.stringify({ error: 'Email required.' }) };

  const res = await fetch(`${SUPABASE_URL}/auth/v1/recover`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'apikey': SUPABASE_ANON_KEY },
    body: JSON.stringify({
      email,
      redirect_to: 'https://dj-you.netlify.app/picker.html',
    }),
  });

  // Supabase returns 200 even if email doesn't exist (security best practice —
  // don't reveal whether an account exists). Always return success to the client.
  return {
    statusCode: 200,
    headers,
    body: JSON.stringify({ ok: true, message: 'If that email has an account, a reset link is on its way.' }),
  };
};

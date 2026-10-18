// admin-verify-access.js — checks the admin page access code (separate from login)
// This is a lightweight gate so /admin.html isn't open to anyone who finds the URL.
const ADMIN_ACCESS_CODE = process.env.ADMIN_ACCESS_CODE || '';

exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json',
  };
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers, body: '' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };

  if (!ADMIN_ACCESS_CODE) {
    return { statusCode: 503, headers, body: JSON.stringify({ error: 'Admin access not configured.' }) };
  }

  let body;
  try { body = JSON.parse(event.body || '{}'); } catch {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Invalid JSON' }) };
  }

  if ((body.code || '').trim() !== ADMIN_ACCESS_CODE.trim()) {
    return { statusCode: 403, headers, body: JSON.stringify({ error: 'Wrong access code.' }) };
  }

  return { statusCode: 200, headers, body: JSON.stringify({ ok: true }) };
};

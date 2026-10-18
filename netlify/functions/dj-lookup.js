// dj-lookup.js — public lookup of a DJ's display name by slug (no auth required)
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Content-Type': 'application/json',
  };
  const slug = event.queryStringParameters?.slug || '';
  if (!slug) return { statusCode: 400, headers, body: JSON.stringify({ error: 'slug required' }) };

  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/dj_profiles?slug=eq.${encodeURIComponent(slug.toLowerCase())}&select=display_name,slug`,
    { headers: { 'apikey': SUPABASE_SERVICE_KEY, 'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}` } }
  );
  const data = await res.json();
  if (!data || !data[0]) return { statusCode: 404, headers, body: JSON.stringify({ error: 'DJ not found' }) };
  return { statusCode: 200, headers, body: JSON.stringify(data[0]) };
};

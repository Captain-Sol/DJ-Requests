// submit-request.js — guest submits a song request, stored in Supabase under the correct DJ
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
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Invalid JSON body' }) };
  }

  const { title, artist, spotifyId, spotifyUrl, djSlug, requesterName } = body;
  if (!title || !artist || !spotifyId || !djSlug) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Missing required fields: title, artist, spotifyId, djSlug' }) };
  }

  const svcH = {
    'apikey': SUPABASE_SERVICE_KEY,
    'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
    'Content-Type': 'application/json',
  };

  // Look up the DJ by slug
  const djRes = await fetch(
    `${SUPABASE_URL}/rest/v1/dj_profiles?slug=eq.${encodeURIComponent(djSlug.toLowerCase())}&select=id,display_name`,
    { headers: svcH }
  );
  const djs = await djRes.json();
  if (!djs || !djs[0]) {
    return { statusCode: 404, headers, body: JSON.stringify({ error: `No DJ found with slug "${djSlug}"` }) };
  }
  const djId = djs[0].id;

  // Insert the request
  const insertRes = await fetch(`${SUPABASE_URL}/rest/v1/dj_requests`, {
    method: 'POST',
    headers: { ...svcH, 'Prefer': 'return=minimal' },
    body: JSON.stringify({
      dj_id: djId,
      song: String(title).trim().slice(0, 200),
      artist: String(artist).trim().slice(0, 200),
      spotify_id: String(spotifyId).trim(),
      spotify_url: String(spotifyUrl || '').trim(),
      requester_name: requesterName ? String(requesterName).trim().slice(0, 100) : null,
      status: 'pending',
    }),
  });

  if (!insertRes.ok) {
    const err = await insertRes.text();
    return { statusCode: 500, headers, body: JSON.stringify({ error: `Failed to save request: ${err}` }) };
  }

  // Fetch the new row id so auto-scan can mark it processed
  const newRowRes = await fetch(
    `${SUPABASE_URL}/rest/v1/dj_requests?dj_id=eq.${djId}&song=eq.${encodeURIComponent(String(title).trim())}&status=eq.pending&order=submitted_at.desc&limit=1&select=id`,
    { headers: svcH }
  );
  const newRows = await newRowRes.json().catch(() => []);
  const requestId = newRows[0]?.id || null;

  // Kick off auto-scan in the background — don't await so guest gets instant response
  const baseUrl = process.env.URL || 'https://dj-you.netlify.app';
  fetch(`${baseUrl}/.netlify/functions/auto-scan-request`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      dj_id: djId,
      request_id: requestId,
      song: String(title).trim(),
      artist: String(artist).trim(),
      spotify_id: String(spotifyId).trim(),
      spotify_url: String(spotifyUrl || '').trim(),
    }),
  }).catch(() => {}); // fire-and-forget

  return { statusCode: 200, headers, body: JSON.stringify({ ok: true, djName: djs[0].display_name }) };
};

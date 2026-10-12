// Netlify serverless function: Spotify search proxy
// Keeps SPOTIFY_CLIENT_ID and SPOTIFY_CLIENT_SECRET server-side only.

const TOKEN_URL = 'https://accounts.spotify.com/api/token';
const SEARCH_URL = 'https://api.spotify.com/v1/search';

// Simple in-memory token cache (survives within a warm function instance)
let cachedToken = null;
let tokenExpiry  = 0;

async function getAccessToken() {
  const now = Date.now();
  if (cachedToken && now < tokenExpiry - 30_000) return cachedToken;

  const clientId     = process.env.SPOTIFY_CLIENT_ID;
  const clientSecret = process.env.SPOTIFY_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    throw new Error('Spotify credentials not configured');
  }

  const credentials = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');

  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: {
      'Authorization': `Basic ${credentials}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: 'grant_type=client_credentials',
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Spotify token error: ${res.status} ${text}`);
  }

  const data = await res.json();
  cachedToken = data.access_token;
  tokenExpiry  = now + data.expires_in * 1000;
  return cachedToken;
}

exports.handler = async (event) => {
  // CORS headers
  const headers = {
    'Access-Control-Allow-Origin':  '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json',
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers, body: '' };
  }

  if (event.httpMethod !== 'GET') {
    return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  const q = (event.queryStringParameters || {}).q || '';
  if (!q.trim()) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Query is required' }) };
  }

  try {
    const token = await getAccessToken();

    const params = new URLSearchParams({
      q:      q.trim(),
      type:   'track',
      limit:  '10',
      market: 'US',
    });

    const res = await fetch(`${SEARCH_URL}?${params}`, {
      headers: { 'Authorization': `Bearer ${token}` },
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Spotify API error: ${res.status} ${text}`);
    }

    const data = await res.json();
    const tracks = (data.tracks?.items || []).map(t => ({
      id:          t.id,
      name:        t.name,
      artists:     t.artists.map(a => a.name).join(', '),
      album:       t.album.name,
      albumArt:    t.album.images?.[1]?.url || t.album.images?.[0]?.url || null,
      duration_ms: t.duration_ms,
      url:         t.external_urls?.spotify || `https://open.spotify.com/track/${t.id}`,
      explicit:    t.explicit,
    }));

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ tracks }),
    };
  } catch (err) {
    console.error('spotify-search error:', err);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: err.message || 'Internal server error' }),
    };
  }
};

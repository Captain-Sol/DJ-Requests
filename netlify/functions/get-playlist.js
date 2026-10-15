// Netlify serverless function: fetch Spotify playlist tracks
// Keeps SPOTIFY_CLIENT_ID and SPOTIFY_CLIENT_SECRET server-side only.

const TOKEN_URL    = 'https://accounts.spotify.com/api/token';
const PLAYLIST_URL = 'https://api.spotify.com/v1/playlists';

let cachedToken = null;
let tokenExpiry  = 0;

async function getAccessToken() {
  const now = Date.now();
  if (cachedToken && now < tokenExpiry - 30_000) return cachedToken;

  const clientId     = process.env.SPOTIFY_CLIENT_ID;
  const clientSecret = process.env.SPOTIFY_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    throw new Error('Spotify credentials not configured on server.');
  }

  const credentials = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');

  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: {
      'Authorization': `Basic ${credentials}`,
      'Content-Type':  'application/x-www-form-urlencoded',
    },
    body: 'grant_type=client_credentials',
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Spotify token error: ${res.status} ${text}`);
  }

  const data  = await res.json();
  cachedToken  = data.access_token;
  tokenExpiry  = now + data.expires_in * 1000;
  return cachedToken;
}

// Extract a Spotify playlist ID from various URL forms:
//   open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M
//   spotify:playlist:37i9dQZF1DXcBWIGoYBM5M
//   spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M?si=...
function extractPlaylistId(input) {
  const s = input.trim();
  // URI form
  const uriMatch = s.match(/^spotify:playlist:([A-Za-z0-9]+)/);
  if (uriMatch) return uriMatch[1];
  // URL form
  const urlMatch = s.match(/playlist\/([A-Za-z0-9]+)/);
  if (urlMatch) return urlMatch[1];
  return null;
}

exports.handler = async (event) => {
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

  const playlistUrl = (event.queryStringParameters || {}).url || '';
  const playlistId  = extractPlaylistId(playlistUrl);

  if (!playlistId) {
    return {
      statusCode: 400,
      headers,
      body: JSON.stringify({ error: 'Could not extract a playlist ID from the URL. Make sure it is an open.spotify.com/playlist/... link.' }),
    };
  }

  try {
    const token  = await getAccessToken();
    const tracks = [];
    let   nextUrl = `${PLAYLIST_URL}/${playlistId}/tracks?limit=100&market=US&fields=next,items(track(name,artists,explicit,duration_ms))`;

    // Paginate up to 300 tracks (3 pages)
    let pages = 0;
    while (nextUrl && pages < 3) {
      const res = await fetch(nextUrl, {
        headers: { 'Authorization': `Bearer ${token}` },
      });

      if (!res.ok) {
        const text = await res.text();
        // 404 = private or non-existent playlist
        if (res.status === 404) {
          return {
            statusCode: 404,
            headers,
            body: JSON.stringify({ error: 'Playlist not found. Make sure it is public and the link is correct.' }),
          };
        }
        throw new Error(`Spotify API error: ${res.status} ${text}`);
      }

      const data = await res.json();
      for (const item of (data.items || [])) {
        const t = item.track;
        if (!t || !t.name) continue; // skip null tracks (deleted songs)
        const artist = (t.artists || []).map(a => a.name).join(', ');
        tracks.push({ name: t.name, artist, explicit: !!t.explicit });
      }
      nextUrl = data.next || null;
      pages++;
    }

    // Also fetch the playlist name for display
    let playlistName = 'Spotify playlist';
    try {
      const metaRes = await fetch(`${PLAYLIST_URL}/${playlistId}?fields=name`, {
        headers: { 'Authorization': `Bearer ${token}` },
      });
      if (metaRes.ok) {
        const meta = await metaRes.json();
        if (meta.name) playlistName = meta.name;
      }
    } catch (_) {}

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ playlistName, trackCount: tracks.length, tracks }),
    };
  } catch (err) {
    console.error('get-playlist error:', err);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: err.message || 'Internal server error' }),
    };
  }
};

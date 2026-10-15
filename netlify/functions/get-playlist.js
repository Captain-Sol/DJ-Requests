// Netlify serverless function: fetch Spotify playlist tracks
// Scrapes the public Spotify page — no API auth required.

function extractPlaylistId(input) {
  const s = input.trim();
  const uriMatch = s.match(/^spotify:playlist:([A-Za-z0-9]+)/);
  if (uriMatch) return uriMatch[1];
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

  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers, body: '' };
  if (event.httpMethod !== 'GET') return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };

  const playlistUrl = (event.queryStringParameters || {}).url || '';
  const playlistId  = extractPlaylistId(playlistUrl);

  if (!playlistId) {
    return {
      statusCode: 400,
      headers,
      body: JSON.stringify({ error: 'Could not extract a playlist ID. Use an open.spotify.com/playlist/... link.' }),
    };
  }

  try {
    // Fetch the public Spotify playlist page
    const pageRes = await fetch(`https://open.spotify.com/playlist/${playlistId}`, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Accept-Language': 'en-US,en;q=0.9',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      },
    });

    if (!pageRes.ok) {
      return {
        statusCode: pageRes.status,
        headers,
        body: JSON.stringify({ error: `Could not fetch playlist page: ${pageRes.status}` }),
      };
    }

    const html = await pageRes.text();

    // Spotify embeds all data in a __NEXT_DATA__ script tag
    const match = html.match(/<script id="__NEXT_DATA__" type="application\/json">([^<]+)<\/script>/);
    if (!match) {
      return {
        statusCode: 422,
        headers,
        body: JSON.stringify({ error: 'Could not find playlist data in page. The playlist may be private.' }),
      };
    }

    const nextData = JSON.parse(match[1]);

    // Navigate the NEXT_DATA structure to find tracks
    // Structure: props.pageProps.state.data.entity or similar
    let entity = null;
    try {
      entity = nextData.props.pageProps.state.data.entity;
    } catch (_) {}

    if (!entity) {
      // Try alternate path
      try {
        const serverData = nextData.props.pageProps.serverRenderedData;
        entity = serverData?.entity || serverData?.playlist;
      } catch (_) {}
    }

    const tracks = [];
    let playlistName = 'Spotify playlist';

    if (entity) {
      playlistName = entity.name || playlistName;
      const items = entity.trackList || entity.tracks?.items || [];
      for (const item of items) {
        const t = item.track || item;
        if (!t || !t.title && !t.name) continue;
        const name   = t.title || t.name;
        const artist = t.subtitle || t.artists?.map(a => a.name || a.profile?.name).join(', ') || '';
        if (name) tracks.push({ name, artist, explicit: !!t.isExplicit });
      }
    }

    // Fallback: pull track names from meta tags if entity parse failed
    if (tracks.length === 0) {
      // Try to extract from JSON-LD or og:title patterns
      const trackMatches = html.matchAll(/"title":"([^"]+)","artists":\[{"name":"([^"]+)"/g);
      for (const m of trackMatches) {
        tracks.push({ name: m[1], artist: m[2], explicit: false });
        if (tracks.length >= 100) break;
      }
    }

    if (tracks.length === 0) {
      return {
        statusCode: 422,
        headers,
        body: JSON.stringify({ error: 'Playlist found but no tracks could be read. It may be private or empty.' }),
      };
    }

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

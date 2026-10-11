// Netlify serverless function: submit song request → Google Apps Script → Sheet

const APPS_SCRIPT_URL = process.env.APPS_SCRIPT_URL ||
  'https://script.google.com/macros/s/AKfycbySBJyiqk1a6UgrdabBLhouxQJqoLyR6QrifnTJWR0XBLVmtR0cK1aRXO9N82XnPcc/exec';

exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin':  '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json',
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers, body: '' };
  }

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  let body;
  try {
    body = JSON.parse(event.body || '{}');
  } catch {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Invalid JSON body' }) };
  }

  const { title, artist, spotifyId, spotifyUrl } = body;

  if (!title || !artist || !spotifyId) {
    return {
      statusCode: 400,
      headers,
      body: JSON.stringify({ error: 'Missing required fields: title, artist, spotifyId' }),
    };
  }

  const payload = {
    action:     'submitRequest',
    title:      String(title).trim().slice(0, 200),
    artist:     String(artist).trim().slice(0, 200),
    spotifyId:  String(spotifyId).trim(),
    spotifyUrl: String(spotifyUrl || '').trim(),
  };

  try {
    const res = await fetch(APPS_SCRIPT_URL, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(payload),
    });

    // Apps Script always returns 200 even for errors; check the JSON body
    const text = await res.text();
    let appsData;
    try { appsData = JSON.parse(text); } catch { appsData = { status: 'ok' }; }

    if (appsData.status === 'error') {
      throw new Error(appsData.message || 'Apps Script returned an error');
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ ok: true }),
    };
  } catch (err) {
    console.error('submit-request error:', err);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: err.message || 'Could not save request' }),
    };
  }
};

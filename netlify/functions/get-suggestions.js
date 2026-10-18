// Server-side suggestion engine — takes play history + vibe and returns next song ideas
exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return { statusCode: 500, body: JSON.stringify({ error: 'ANTHROPIC_API_KEY not set.' }) };
  }

  let body;
  try { body = JSON.parse(event.body); }
  catch (e) { return { statusCode: 400, body: JSON.stringify({ error: 'Invalid JSON.' }) }; }

  const { history = [], pool = [], vibeContext = '', filterMode = 'somegrime', playlistTracks = [] } = body;

  // Build a compact history string (last 10 played)
  const recentHistory = history.slice(-10).map(s => `"${s.song}" by ${s.artist} (energy: ${s.energy || 'unknown'})`).join('\n');
  const poolSongs = pool.slice(0, 20).map(s => `"${s.song}" by ${s.artist}`).join(', ');

  const filterNote = filterMode === 'cleanest'
    ? 'This is a family/kids event — suggest only clean, universally appropriate songs.'
    : filterMode === 'nofilter'
    ? 'This is an adult event with no content restrictions.'
    : 'This is a school event — avoid explicit content.';

  // If a reference playlist was loaded, make it the dominant directive
  const playlistSection = playlistTracks.length > 0
    ? `REFERENCE PLAYLIST (this is the PRIMARY guide — suggestions MUST come from this playlist or sound exactly like songs on it):
${playlistTracks.slice(0, 60).join('\n')}

IMPORTANT: The DJ specifically loaded this playlist to set the vibe. At least 4 of your 5 suggestions should be songs directly from this list or artists heavily represented in it. Do not suggest generic crowd-pleasers that ignore this playlist.`
    : '';

  const prompt = `You are a professional DJ assistant. Based on the songs recently played and the event vibe, suggest 5 great next songs to play.

${playlistSection}

EVENT VIBE:
${vibeContext || 'General dance event.'}

CONTENT FILTER: ${filterNote}

RECENTLY PLAYED (most recent last):
${recentHistory || 'Nothing played yet — suggest crowd-warming openers.'}

ALREADY IN QUEUE (don't repeat these):
${poolSongs || 'None yet.'}

Rules:
- If a reference playlist is provided above, treat it as the top priority — pull suggestions from it first
- Match and build the energy flow naturally (don't drop from high to slow without a mid transition)
- Vary artists — don't suggest the same artist twice in the list
- Don't repeat songs already played or in queue
- Consider what would get people on the floor RIGHT NOW given what just played

Respond ONLY with valid JSON, no markdown, no explanation:
{
  "suggestions": [
    { "song": "Song Title", "artist": "Artist Name", "reason": "One short sentence on why this fits right now", "energy": "high|mid|slow" },
    { "song": "Song Title", "artist": "Artist Name", "reason": "...", "energy": "high|mid|slow" },
    { "song": "Song Title", "artist": "Artist Name", "reason": "...", "energy": "high|mid|slow" },
    { "song": "Song Title", "artist": "Artist Name", "reason": "...", "energy": "high|mid|slow" },
    { "song": "Song Title", "artist": "Artist Name", "reason": "...", "energy": "high|mid|slow" }
  ]
}`;

  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 600,
        messages: [{ role: 'user', content: prompt }]
      })
    });

    if (!res.ok) {
      const err = await res.text();
      return { statusCode: res.status, body: JSON.stringify({ error: `Anthropic error: ${err}` }) };
    }

    const data = await res.json();
    const text = data.content.map(b => b.text || '').join('').trim();
    const parsed = JSON.parse(text.replace(/```json|```/g, '').trim());

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(parsed)
    };
  } catch (e) {
    return { statusCode: 500, body: JSON.stringify({ error: e.message || String(e) }) };
  }
};

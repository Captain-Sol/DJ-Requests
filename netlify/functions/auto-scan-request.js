// auto-scan-request.js — called internally after a guest submits a request.
// Runs the Claude content check and writes the result directly into the DJ's
// pool, flagged, or denied table. The DJ never has to manually approve.
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;

const svcH = () => ({
  'apikey': SUPABASE_SERVICE_KEY,
  'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
  'Content-Type': 'application/json',
});

// Fetch the DJ's current content filter mode and vibe context from dj_settings
async function getDJSettings(djId) {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/dj_settings?dj_id=eq.${djId}&select=filter_mode,vibe_prompt,event_type`,
    { headers: svcH() }
  );
  const rows = await res.json();
  return rows[0] || { filter_mode: 'somegrime', vibe_prompt: '', event_type: 'mixed' };
}

// Run Claude content review
async function claudeCheck(song, artist, filterMode, vibeContext) {
  const MODE_CONFIG = {
    cleanest: {
      label: 'elementary school / family event (ages 5–12)',
      rules: [
        'Any profanity — including mild words like "damn", "hell", "crap", "ass", "bitch" — is an automatic FLAG.',
        'Any romantic or sexual content beyond hand-holding: FLAG.',
        'Any drug or alcohol references, even casual: FLAG.',
        'Any scary, violent, or dark themes: FLAG.',
        'Any glorification of criminal activity or gangs: FLAG.',
        'APPROVE only squeaky-clean pop, kids\' music, or universally safe radio hits a parent would play at a church event.',
        'When in doubt: FLAG. Do not give benefit of the doubt.',
      ],
    },
    somegrime: {
      label: 'middle school or high school dance (ages 11–17)',
      rules: [
        'Explicit sexual content or graphic sexual language: FLAG (even if censored in title, if the original is explicit).',
        'Uncensored slurs (racial, homophobic, etc.): FLAG.',
        'Graphic violence or detailed descriptions of assault: FLAG.',
        'Glorification of hard drug use (not just a passing mention): FLAG.',
        'The F-word used repeatedly or as the main subject: FLAG.',
        'APPROVE: mild romance, dancing/party themes, mild profanity ("damn", "hell"), alcohol mentions without glorification, hip-hop with standard lyrical themes.',
        'If the commonly known version is explicit but a clean/radio edit exists: note this in possibleDiscrepancies.',
        'Songs widely known to be clean or radio-safe (regardless of artist reputation) should be APPROVED.',
        'When in doubt about a borderline case: APPROVE with a note, do not over-flag.',
      ],
    },
    nofilter: {
      label: 'adult party with no content restrictions',
      rules: [
        'Always set "appropriate": true.',
        'Still assess energy level and vibe fit accurately.',
        'Note any possible clean vs. explicit version discrepancies.',
      ],
    },
  };

  const modeConfig = MODE_CONFIG[filterMode] || MODE_CONFIG.somegrime;
  const rulesText = modeConfig.rules.map((r, i) => `${i + 1}. ${r}`).join('\n');

  const prompt = `You are an expert music content reviewer for a DJ event management tool.
You have deep knowledge of popular music across all genres. You know actual lyrics, themes, and reputation.

CURRENT EVENT TYPE: ${modeConfig.label}

CONTENT RULES FOR THIS MODE:
${rulesText}

LYRIC RECALL INSTRUCTIONS:
- Recall the actual lyrics and themes of the song from your training data.
- If you know the song is commonly associated with explicit content, treat it as explicit even if the title looks clean.
- If the song has both clean and explicit versions, note this prominently in possibleDiscrepancies.
- If you genuinely don't know the song, set confidence to "low" and lean toward APPROVE with a caveat.

---
SONG TO REVIEW: "${song}" by "${artist || 'Unknown Artist'}"

VIBE CONTEXT: ${vibeContext || 'No vibe context provided.'}

Respond ONLY with valid JSON, no other text:
{
  "appropriate": true,
  "reason": "Brief reason",
  "reputationOverview": "1–2 sentences about this song's actual content",
  "possibleDiscrepancies": ["any clean/explicit version issues"],
  "confidence": "high|medium|low",
  "energy": "high|mid|slow|unknown",
  "vibeNote": "1 sentence on vibe fit"
}`;

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-6',
      max_tokens: 900,
      messages: [{ role: 'user', content: prompt }],
    }),
  });

  if (!res.ok) throw new Error(`Claude API ${res.status}`);
  const data = await res.json();
  const text = data.content.map(b => b.text || '').join('').trim();
  let parsed;
  try {
    parsed = JSON.parse(text.replace(/```json|```/g, '').trim());
  } catch {
    // Malformed response — flag for manual review
    return { appropriate: null, reason: 'Parse error — flagged for manual check.', energy: 'unknown', confidence: 'low', possibleDiscrepancies: [], reputationOverview: '', vibeNote: '' };
  }
  parsed.possibleDiscrepancies = Array.isArray(parsed.possibleDiscrepancies) ? parsed.possibleDiscrepancies : [];
  parsed.energy = ['high', 'mid', 'slow'].includes(parsed.energy) ? parsed.energy : 'unknown';
  parsed.confidence = ['high', 'medium', 'low'].includes(parsed.confidence) ? parsed.confidence : 'medium';
  parsed.appropriate = typeof parsed.appropriate === 'boolean' ? parsed.appropriate : null;
  return parsed;
}

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

  const { dj_id, request_id, song, artist, spotify_url } = body;
  if (!dj_id || !song) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'dj_id and song required' }) };
  }

  // Get DJ settings (filter mode, vibe)
  const settings = await getDJSettings(dj_id);
  const filterMode = settings.filter_mode || 'somegrime';
  const vibeContext = [settings.vibe_prompt, settings.event_type].filter(Boolean).join(' — ');

  // Run Claude scan
  let review;
  try {
    review = await claudeCheck(song, artist || '', filterMode, vibeContext);
  } catch (e) {
    // Claude unavailable — put in flagged so DJ sees it
    review = { appropriate: null, reason: 'Claude scan failed — manual review needed.', energy: 'unknown', confidence: 'low', possibleDiscrepancies: [], reputationOverview: '', vibeNote: '' };
  }

  const now = new Date().toISOString();
  const base = {
    dj_id,
    song,
    artist: artist || '—',
    spotify_url: spotify_url || null,
    added_at: now,
    had_lyrics: false,
    reputation_overview: review.reputationOverview || '',
    confidence: review.confidence || 'medium',
    energy: review.energy || 'unknown',
    vibe_note: review.vibeNote || '',
  };

  if (review.appropriate === true) {
    // → Approved pool
    await fetch(`${SUPABASE_URL}/rest/v1/dj_pool`, {
      method: 'POST',
      headers: { ...svcH(), 'Prefer': 'return=minimal' },
      body: JSON.stringify({ ...base }),
    });
  } else if (review.appropriate === false) {
    // → Denied (auto-deny: inappropriate songs)
    await fetch(`${SUPABASE_URL}/rest/v1/dj_denied`, {
      method: 'POST',
      headers: { ...svcH(), 'Prefer': 'return=minimal' },
      body: JSON.stringify({ ...base, deny_count: 1 }),
    });
  } else {
    // appropriate === null → Flagged (parse error, scan failure, etc.)
    await fetch(`${SUPABASE_URL}/rest/v1/dj_flagged`, {
      method: 'POST',
      headers: { ...svcH(), 'Prefer': 'return=minimal' },
      body: JSON.stringify({ ...base, reason: review.reason || 'Flagged for review.' }),
    });
  }

  // Mark the dj_request row as processed
  if (request_id) {
    const finalStatus = review.appropriate === true ? 'approved' : review.appropriate === false ? 'denied' : 'flagged';
    await fetch(`${SUPABASE_URL}/rest/v1/dj_requests?id=eq.${request_id}`, {
      method: 'PATCH',
      headers: { ...svcH(), 'Prefer': 'return=minimal' },
      body: JSON.stringify({ status: finalStatus }),
    }).catch(() => {});
  }

  return {
    statusCode: 200,
    headers,
    body: JSON.stringify({ ok: true, result: review.appropriate === true ? 'approved' : review.appropriate === false ? 'denied' : 'flagged' }),
  };
};

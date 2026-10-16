
exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'ANTHROPIC_API_KEY is not set in environment variables.' })
    };
  }

  let body;
  try {
    body = JSON.parse(event.body);
  } catch (e) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Invalid JSON body.' }) };
  }

  const { song, artist, filterMode, vibeContext } = body;
  if (!song) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Missing required field: song.' }) };
  }

  // ── Filter mode system prompts ──
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
        'When in doubt: FLAG. Do not give benefit of the doubt.'
      ]
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
        'When in doubt about a borderline case: APPROVE with a note, do not over-flag.'
      ]
    },
    nofilter: {
      label: 'adult party with no content restrictions',
      rules: [
        'Always set "appropriate": true.',
        'Still assess energy level and vibe fit accurately.',
        'Note any possible clean vs. explicit version discrepancies.'
      ]
    }
  };

  const modeConfig = MODE_CONFIG[filterMode] || MODE_CONFIG.somegrime;
  const rulesText = modeConfig.rules.map((r, i) => `${i + 1}. ${r}`).join('\n');

  const systemPrompt = `You are an expert music content reviewer for a DJ event management tool.
You have deep knowledge of popular music across all genres — hip-hop, R&B, pop, rock, EDM, country, and more.
You know actual lyrics, song themes, and reputation for songs from your training data.
You do NOT have access to Genius or external APIs, but you DO have extensive internal knowledge of song content.

CURRENT EVENT TYPE: ${modeConfig.label}

CONTENT RULES FOR THIS MODE:
${rulesText}

LYRIC RECALL INSTRUCTIONS:
- Recall the actual lyrics and themes of the song from your training data.
- If you know the song is commonly associated with explicit content in its standard version, treat it as explicit even if the title looks clean.
- If the song has both clean and explicit versions, note this prominently in possibleDiscrepancies and in your reason.
- If you genuinely don't know the song, set confidence to "low" and lean toward APPROVE with a caveat, unless the artist is known for extreme content.

CRITICAL: Be consistent. A song you would flag once should always be flagged under the same filter mode. Use your best knowledge of the song's actual content, not just its surface reputation.`;

  const prompt = `${systemPrompt}

---
SONG TO REVIEW: "${song}" by "${artist || 'Unknown Artist'}"

VIBE CONTEXT (separate from content — use for energy/vibe assessment only):
${vibeContext || 'No vibe context provided.'}

---
Based on your knowledge of this song:
1. Recall its actual lyrics, themes, and content profile.
2. Apply the content rules for the current event type.
3. Assess its energy level: "high" (gets the crowd going), "mid" (moderate), "slow" (slow dance/chill), or "unknown".
4. Note any clean vs. explicit version issues.

Respond ONLY with valid JSON, no other text:
{
  "appropriate": true,
  "reason": "Brief, specific reason for approval or flag — reference actual lyric content or known themes",
  "reputationOverview": "1–2 sentences about this song's actual content and reputation",
  "possibleDiscrepancies": ["List any clean/explicit version issues, title mismatches, or version ambiguities"],
  "confidence": "high|medium|low",
  "energy": "high|mid|slow|unknown",
  "vibeNote": "1 sentence on how well this fits the event vibe and crowd"
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
        max_tokens: 900,
        messages: [{ role: 'user', content: prompt }]
      })
    });

    if (!res.ok) {
      const errText = await res.text();
      return {
        statusCode: res.status,
        body: JSON.stringify({ error: `Anthropic API error ${res.status}: ${errText}` })
      };
    }

    const data = await res.json();
    if (data.error) {
      return { statusCode: 500, body: JSON.stringify({ error: JSON.stringify(data.error) }) };
    }

    const text = data.content.map(b => b.text || '').join('').trim();
    let parsed;
    try {
      parsed = JSON.parse(text.replace(/```json|```/g, '').trim());
    } catch (parseErr) {
      return {
        statusCode: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          appropriate: true,
          reason: 'Could not parse review response — flagged for manual check.',
          reputationOverview: 'Review response was malformed or truncated.',
          possibleDiscrepancies: ['Manual review recommended'],
          confidence: 'low',
          energy: 'unknown',
          vibeNote: ''
        })
      };
    }

    parsed.possibleDiscrepancies = Array.isArray(parsed.possibleDiscrepancies) ? parsed.possibleDiscrepancies : [];
    parsed.reputationOverview = parsed.reputationOverview || 'No reputation overview provided.';
    parsed.confidence = ['high', 'medium', 'low'].includes(parsed.confidence) ? parsed.confidence : 'medium';
    parsed.energy = ['high', 'mid', 'slow'].includes(parsed.energy) ? parsed.energy : 'unknown';
    parsed.vibeNote = parsed.vibeNote || '';
    parsed.appropriate = !!parsed.appropriate;

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(parsed)
    };
  } catch (e) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: e.message || String(e) })
    };
  }
};

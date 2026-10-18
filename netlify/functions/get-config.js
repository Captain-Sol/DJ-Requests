// Returns non-secret config values the picker needs (e.g. the Apps Script URL).
// The actual secret keys (Anthropic, Spotify) are never returned here.
exports.handler = async () => {
  const appsScriptUrl = process.env.APPS_SCRIPT_URL || '';
  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ appsScriptUrl })
  };
};

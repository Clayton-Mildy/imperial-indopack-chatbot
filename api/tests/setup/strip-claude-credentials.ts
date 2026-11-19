// Runs before every test file, after dotenv/config has loaded api/.env. The real Claude
// subscription tokens (CLAUDE_CODE_OAUTH_TOKEN_1.._N, ANTHROPIC_AUTH_TOKEN) live in that .env for
// the running bot; tests must never pick them up - they would change which transport getClient()
// builds and could spend real quota. A test that needs tokens sets its own fake ones.
for (const key of Object.keys(process.env)) {
  if (/^CLAUDE_CODE_OAUTH_TOKEN(_\d+)?$/.test(key) || key === 'ANTHROPIC_AUTH_TOKEN') {
    delete process.env[key]
  }
}

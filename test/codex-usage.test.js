import assert from 'node:assert/strict'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { normalizeCodexUsage, queryCodexUsage } from '../codex-usage.js'

const fake = fileURLToPath(new URL('./fake-codex.js', import.meta.url))

test('normalizes the Codex bucket without forwarding private fields', () => {
  const result = normalizeCodexUsage({ accountId: 'secret', rateLimits: { primary: { usedPercent: 5 } }, rateLimitsByLimitId: {
    codex: {
      planType: 'plus', primary: { usedPercent: 78, windowDurationMins: 300, resetsAt: 2000000000 },
      secondary: { usedPercent: 0, windowDurationMins: 10080, resetsAt: null },
      credits: { hasCredits: true, unlimited: false, balance: '2.5', secret: 'hidden' },
    },
  } })
  assert.equal(result.primary.usedPercent, 78)
  assert.equal(result.secondary.usedPercent, 0)
  assert.equal(result.credits.balance, '2.5')
  assert.doesNotMatch(JSON.stringify(result), /secret|hidden/)
})

test('queries subscription quota through the app-server handshake', async () => {
  const result = await queryCodexUsage(fake)
  assert.equal(result.ok, true)
  assert.equal(result.signedIn, true)
  assert.equal(result.data.primary.usedPercent, 75)
  assert.equal(result.data.secondary.windowDurationMins, 10080)
  assert.doesNotMatch(JSON.stringify(result), /DO-NOT-LEAK/)
})

test('does not request subscription quota for API-key account', async () => {
  process.env.FAKE_CODEX_MODE = 'apiKey'
  try {
    const result = await queryCodexUsage(fake)
    assert.equal(result.signedIn, false)
    assert.equal(result.error, 'CHATGPT_LOGIN_REQUIRED')
  } finally { delete process.env.FAKE_CODEX_MODE }
})

test('reports offline status without exposing backend diagnostics', async () => {
  process.env.FAKE_CODEX_MODE = 'offline'
  try {
    const result = await queryCodexUsage(fake)
    assert.equal(result.signedIn, true)
    assert.equal(result.error, 'USAGE_UNAVAILABLE')
    assert.doesNotMatch(JSON.stringify(result), /private backend/)
  } finally { delete process.env.FAKE_CODEX_MODE }
})

test('reports a missing executable separately from a signed-out account', async () => {
  const result = await queryCodexUsage('unlikely-codex-command-that-does-not-exist-2938')
  assert.equal(result.available, false)
  assert.equal(result.error, 'CODEX_NOT_FOUND')
})

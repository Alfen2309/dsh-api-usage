import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import { test } from 'node:test'

const source = readFileSync(new URL('../src/client.js', import.meta.url), 'utf8')
const adapter = source.slice(source.indexOf('    function codexWindow('), source.indexOf('    /* ── shared summary store'))

/**
 * Load the real adapter code with a fake RPC. `answers` maps endpoint → reply,
 * so a test can make `status` fail while `usage/accounts` still answers.
 */
function load(answers) {
  const calls = []
  const context = vm.createContext({
    toNumberOrNull: value => typeof value === 'number' && Number.isFinite(value) ? value : null,
    subscriptionRpc: () => ({
      call: async (channel, endpoint, payload) => {
        calls.push({ channel, endpoint, payload })
        return answers[endpoint] ?? null
      },
    }),
  })
  vm.runInContext(adapter, context)
  return { read: () => context.readSubscriptionCodex(), calls }
}

const usageOf = (usedPercent, windowSeconds = 18000, extra = {}) => ({
  planType: 'plus',
  rateLimits: [{ id: 'codex', windows: [
    { usedPercent, windowSeconds, resetsAt: 2000000000 },
    { usedPercent: 40, windowSeconds: 604800, resetsAt: 2000100000 },
  ] }],
  credits: { hasCredits: false, unlimited: false },
  ...extra,
})

test('lists every subscription account, not just the selected one', async () => {
  const { read, calls } = load({
    'usage/accounts': { ok: true, value: { accounts: [
      { id: 'acc-1', usage: usageOf(12) },
      { id: 'acc-2', usage: usageOf(56) },
    ] } },
    status: { ok: true, value: { activeId: 'acc-2', accounts: [
      { id: 'acc-1', label: 'Work' },
      { id: 'acc-2', label: 'Personal' },
    ] } },
  })
  const result = await read()
  assert.equal(result.accounts.length, 2)
  assert.equal(result.accounts[0].name, 'Work')
  assert.equal(result.accounts[1].name, 'Personal')
  assert.equal(result.accounts[1].data.primary.usedPercent, 56)
  assert.equal(result.activeId, 'codex:acc-2')
  assert.equal(calls[0].endpoint, 'usage/accounts')
  assert.equal(calls[1].endpoint, 'status')
})

test('converts window seconds and drops private fields', async () => {
  const { read } = load({
    'usage/accounts': { ok: true, value: { accounts: [{ id: 'acc-1', usage: usageOf(12, 604800, { privateToken: 'never-copy' }) }] } },
    status: { ok: true, value: { accounts: [] } },
  })
  const result = await read()
  assert.equal(result.accounts[0].data.primary.windowDurationMins, 10080)
  assert.equal(result.accounts[0].source, 'subscription')
  assert.doesNotMatch(JSON.stringify(result), /never-copy|privateToken/)
})

test('keeps an unreadable account visible instead of hiding it', async () => {
  const { read } = load({
    'usage/accounts': { ok: true, value: { accounts: [
      { id: 'acc-1', usage: usageOf(30) },
      { id: 'acc-2', error: 'ChatGPT sign-in needs to be renewed' },
    ] } },
    status: { ok: true, value: { accounts: [] } },
  })
  const result = await read()
  assert.equal(result.accounts.length, 2)
  assert.equal(result.accounts[1].ok, false)
  assert.equal(result.accounts[1].error, 'USAGE_UNAVAILABLE')
})

test('does not substitute a different quota bucket for Codex', async () => {
  const { read } = load({
    'usage/accounts': { ok: true, value: { accounts: [{ id: 'acc-1', usage: { rateLimits: [{ id: 'code_review', windows: [{ usedPercent: 25 }] }] } }] } },
    status: { ok: true, value: { accounts: [] } },
  })
  const result = await read()
  assert.equal(result.accounts[0].ok, false)
})

test('RPC failures allow the CLI fallback', async () => {
  const { read } = load({ 'usage/accounts': { ok: false, error: { message: 'unavailable' } } })
  assert.equal(await read(), null)
})

test('status failure still lists accounts under fallback names', async () => {
  const { read } = load({
    'usage/accounts': { ok: true, value: { accounts: [{ id: 'acc-1', usage: usageOf(20) }] } },
    status: null,
  })
  const result = await read()
  assert.equal(result.accounts[0].name, 'Codex #1')
  assert.equal(result.activeId, null)
})

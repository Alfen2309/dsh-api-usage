import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import z from '@deepseek-ai/schemastery'
import { credentialKey, credentialKeyId, credentialKeyScope, credentialRef } from '@deepseek-ai/dsh-credentials'

/**
 * dsh-api-usage — host half.
 *
 * Registers two exact HTTP routes on the Web server:
 *
 *   GET  /api-usage/summary
 *     Discovers every DeepSeek / GLM Coding API key currently referenced by
 *     the composed LLM provider configuration (plus `llm.listProviders()` and
 *     a probe of well-known credential reference names), resolves each key
 *     through `ctx.credentials` per request, queries the vendor endpoints in
 *     parallel, and returns one aggregate JSON envelope. Also reads the
 *     signed-in DeepSeek account through the `deepseekAccount` host service.
 *     Key values never leave the host: the response carries balances, quotas,
 *     and a 4-char masked tail only.
 *
 *   POST /api-usage/visibility
 *     Persists one source's show/hide choice into this plugin's own config
 *     through the config editor, so the choice syncs across browsers.
 *
 * Data sources (all verified live):
 *   - DeepSeek  GET <base>/user/balance                           (official docs)
 *   - GLM       GET <base>/api/monitor/usage/quota/limit          (coding-plan quota)
 *   - GLM       GET <base>/api/monitor/credit-usage/usage-detail  (today's spend)
 * The GLM monitor family authenticates with the raw key in the
 * `authorization` header; a Bearer retry covers endpoints that want it.
 */

const name = 'api-usage'

const inject = ['webServer', 'credentials']

const Config = z.object({
  deepseekBaseURL: z.string().default('https://api.deepseek.com'),
  glmBaseURL: z.string().default('https://open.bigmodel.cn'),
  pollSeconds: z.number().default(60),
  lowBalance: z.number().default(20),
  /** Days of metered history kept in the local ledger (default ~13 months). */
  retainDays: z.number().default(400),
  /** Footer presentation retained for compatibility. */
  footerStyle: z.string().default('detailed'),
  /** Source id shown on the composer badge; empty = signed-in account. */
  selectedSource: z.string().default(''),
  hidden: z.array(z.string()).default([]),
  extraRefs: z.array(z.object({
    vendor: z.string(),
    ref: z.string(),
  })).default([]),
})

/** Upstream request timeout. */
const UPSTREAM_TIMEOUT_MS = 15000

/**
 * Scope of the credential records this plugin owns. Credential *references*
 * cannot be enumerated by the seam, so any key beyond the ones the composed
 * LLM provider rows name is stored as an `api-usage/<id>` record, which does
 * enumerate. That is what lets the Settings page list and manage arbitrary
 * extra DeepSeek / GLM keys.
 */
const RECORD_SCOPE = 'api-usage'

/** Well-known credential reference names probed as a discovery fallback. */
const PROBE_REFS = [
  { vendor: 'deepseek', ref: 'DEEPSEEK_API_KEY' },
  { vendor: 'deepseek', ref: 'DEEPSEEK_API_KEY_2' },
  { vendor: 'deepseek', ref: 'DEEPSEEK_API_KEY_3' },
  { vendor: 'deepseek', ref: 'DEEPSEEK_KEY' },
  { vendor: 'glm', ref: 'ZAI_CODING_CN_API_KEY' },
  { vendor: 'glm', ref: 'ZAI_API_KEY' },
  { vendor: 'glm', ref: 'ZAI_CODING_API_KEY' },
  { vendor: 'glm', ref: 'GLM_API_KEY' },
  { vendor: 'glm', ref: 'GLM_CODING_API_KEY' },
  { vendor: 'glm', ref: 'ZHIPU_API_KEY' },
  { vendor: 'glm', ref: 'ZHIPUAI_API_KEY' },
  { vendor: 'glm', ref: 'BIGMODEL_API_KEY' },
]

function writeJson(res, status, payload) {
  const body = JSON.stringify(payload)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  })
  res.end(body)
}

function readBody(req) {
  return new Promise((resolve) => {
    let data = ''
    req.on('data', (chunk) => {
      data += chunk
      if (data.length > 65536) req.destroy()
    })
    req.on('end', () => {
      try {
        resolve(JSON.parse(data || '{}'))
      } catch {
        resolve({})
      }
    })
    req.on('error', () => resolve({}))
  })
}

function signal() {
  return AbortSignal.timeout(UPSTREAM_TIMEOUT_MS)
}

async function fetchJson(url, headers, requestOptions) {
  const response = await fetch(url, {
    headers,
    signal: signal(),
    ...requestOptions,
  })
  const text = await response.text()
  let json = null
  try {
    json = text ? JSON.parse(text) : null
  } catch {
    json = null
  }
  return { status: response.status, ok: response.ok, json, text }
}

/* ── vendor classification ─────────────────────────────────────────────── */

/** Classify one provider identity as 'deepseek' | 'glm' | null (unknown). */
function classifyVendor(providerId, ref, baseURL) {
  const haystack = `${providerId} ${ref} ${baseURL ?? ''}`.toLowerCase()
  const glm = /(^|[^a-z0-9])(zai|zhipu|bigmodel|glm)([^a-z0-9]|$)/.test(haystack)
    || haystack.includes('bigmodel.cn')
    || haystack.includes('api.z.ai')
  const deepseek = haystack.includes('deepseek')
  if (deepseek && !glm) return 'deepseek'
  if (glm && !deepseek) return 'glm'
  return null
}

function classifyRefName(ref) {
  if (/DEEPSEEK/i.test(ref)) return 'deepseek'
  if (/(ZAI|GLM|ZHIPU|BIGMODEL)/i.test(ref)) return 'glm'
  return null
}

/**
 * Default apiKeyEnv references for providers whose reference is not written
 * into the composed configuration (built-in directory rows).
 */
const DEFAULT_PROVIDER_REFS = {
  'deepseek-official': 'DEEPSEEK_API_KEY',
  deepseek: 'DEEPSEEK_API_KEY',
  'zai-coding-cn': 'ZAI_CODING_CN_API_KEY',
  zai: 'ZAI_API_KEY',
}

/** Providers whose balance is owned by the account service, not a key. */
const ACCOUNT_PROVIDERS = new Set(['deepseek-account'])

/**
 * Discover every billable source, in this order:
 *   1. each live `llm` provider that resolves to an API-key reference,
 *      labelled with its display name (this is the list the Models settings
 *      page shows, so the plugin mirrors what the user configured);
 *   2. well-known reference names that resolve but back no provider;
 *   3. this plugin's own enumerable credential records (Settings → add key);
 *   4. `extraRefs` from plugin config.
 *
 * Two providers may share one reference; each stays its own row because they
 * are separate rows in the user's configuration, and the shared reference is
 * queried once and its result reused.
 */
async function discoverSources(ctx, extraRefs) {
  const sources = []
  const seenIds = new Set()
  const debug = {
    configEditorAvailable: false,
    configProviderRows: 0,
    llmAvailable: false,
    llmProviderCount: 0,
    providers: [],
    probed: {},
    recordCount: 0,
  }

  const push = (source) => {
    if (seenIds.has(source.id)) return
    seenIds.add(source.id)
    sources.push(source)
  }

  /* ── reference map: provider id → apiKeyEnv ─────────────────────────── */
  const configuredRefs = new Map()
  const configEditor = ctx.get('configEditor')
  if (configEditor !== undefined) {
    debug.configEditorAvailable = true
    try {
      for (const row of configEditor.configuration()) {
        const merged = {}
        for (const layer of [row && row.inherited, row && row.override]) {
          if (layer !== null && typeof layer === 'object' && layer.providers !== null && typeof layer.providers === 'object') {
            Object.assign(merged, layer.providers)
          }
        }
        for (const [providerId, provider] of Object.entries(merged)) {
          if (provider === null || typeof provider !== 'object') continue
          const ref = typeof provider.apiKeyEnv === 'string' ? provider.apiKeyEnv.trim() : ''
          if (ref !== '') {
            configuredRefs.set(providerId, ref)
            debug.configProviderRows += 1
          }
        }
      }
    } catch (err) {
      debug.configError = err instanceof Error ? err.message : String(err)
    }
  }

  /* ── live provider directory ────────────────────────────────────────── */
  const llm = ctx.get('llm')
  let liveProviders = []
  if (llm !== undefined) {
    debug.llmAvailable = true
    try {
      const providers = await llm.listProviders()
      if (Array.isArray(providers)) {
        debug.llmProviderCount = providers.length
        liveProviders = providers.filter((provider) => provider !== null && typeof provider === 'object')
      }
    } catch (err) {
      debug.llmError = err instanceof Error ? err.message : String(err)
    }
  }

  /* display names from the configurable directory, when present */
  const displayNames = new Map()
  if (llm !== undefined) {
    try {
      const configurable = await llm.listConfigurableProviders()
      if (Array.isArray(configurable)) {
        for (const entry of configurable) {
          if (entry === null || typeof entry !== 'object') continue
          const id = typeof entry.provider === 'string' ? entry.provider : ''
          if (id === '') continue
          displayNames.set(id, typeof entry.displayName === 'string' && entry.displayName !== '' ? entry.displayName : id)
        }
      }
    } catch {
      /* the live list still carries its own names */
    }
  }

  /* ── 1. one row per billable provider ───────────────────────────────── */
  const usedRefs = new Set()
  for (const provider of liveProviders) {
    const providerId = typeof provider.id === 'string' ? provider.id : ''
    if (providerId === '' || ACCOUNT_PROVIDERS.has(providerId)) continue
    const displayName = typeof provider.name === 'string' && provider.name !== ''
      ? provider.name
      : displayNames.get(providerId) ?? providerId
    const configuredRef = configuredRefs.get(providerId) ?? DEFAULT_PROVIDER_REFS[providerId] ?? ''
    const vendor = classifyVendor(providerId, configuredRef, provider.baseURL)
      ?? classifyRefName(configuredRef)
      ?? classifyRefName(providerId)
    if (vendor === null) continue
    if (configuredRef === '') continue

    /* keep the reference only when it actually resolves */
    let resolves = false
    try {
      const info = await ctx.credentials.describe(credentialRef(configuredRef))
      resolves = info !== undefined && info.configured === true
    } catch {
      resolves = false
    }
    debug.providers.push({ provider: providerId, displayName, vendor, ref: configuredRef, resolves })
    if (!resolves) continue

    usedRefs.add(configuredRef)
    push({
      id: `provider:${providerId}`,
      vendor,
      ref: configuredRef,
      origin: providerId,
      kind: 'ref',
      recordId: null,
      label: displayName,
    })
  }

  /* ── 2. configured references backing no live provider ──────────────── */
  for (const ref of new Set([...usedRefs, ...configuredRefs.values()])) {
    if (sources.some((source) => source.ref === ref)) continue
    const vendor = classifyRefName(ref)
    if (vendor === null) continue
    try {
      const info = await ctx.credentials.describe(credentialRef(ref))
      if (info === undefined || info.configured !== true) continue
    } catch {
      continue
    }
    push({ id: `ref:${ref}`, vendor, ref, origin: 'config', kind: 'ref', recordId: null, label: ref })
  }

  /* ── 2b. well-known name probes (fallback for unlabelled keys) ──────── */
  for (const probe of PROBE_REFS) {
    const vendor = probe.vendor
    try {
      const info = await ctx.credentials.describe(credentialRef(probe.ref))
      const configured = info !== undefined && info.configured === true
      debug.probed[probe.ref] = configured
      if (!configured) continue
      if (sources.some((source) => source.ref === probe.ref)) continue
      push({ id: `ref:${probe.ref}`, vendor, ref: probe.ref, origin: 'probe', kind: 'ref', recordId: null, label: probe.ref })
    } catch {
      debug.probed[probe.ref] = false
    }
  }

  /* ── 3. this plugin's own records ───────────────────────────────────── */
  const managed = await listManagedKeys(ctx)
  debug.recordCount = managed.length
  for (const record of managed) {
    push({
      id: `rec:${record.id}`,
      vendor: record.vendor,
      ref: null,
      origin: 'managed',
      kind: 'record',
      recordId: record.id,
      label: record.label,
      tail: record.tail,
    })
  }

  /* ── 4. plugin-config additions ─────────────────────────────────────── */
  for (const extra of Array.isArray(extraRefs) ? extraRefs : []) {
    if (extra === null || typeof extra !== 'object') continue
    const vendor = extra.vendor === 'glm' ? 'glm' : extra.vendor === 'deepseek' ? 'deepseek' : null
    const ref = typeof extra.ref === 'string' ? extra.ref.trim() : ''
    if (vendor === null || ref === '') continue
    push({ id: `ref:${ref}`, vendor, ref, origin: 'extra', kind: 'ref', recordId: null, label: ref })
  }

  return { sources, debug }
}

/* ── plugin-managed keys (enumerable credential records) ────────────────── */

function newRecordId(vendor) {
  const suffix = globalThis.crypto.randomUUID().replace(/-/g, '').slice(0, 8)
  return `${vendor === 'glm' ? 'glm' : 'ds'}-${suffix}`
}

function recordToView(id, record) {
  const payload = record !== null && typeof record === 'object' && record.payload !== null && typeof record.payload === 'object'
    ? record.payload
    : {}
  const key = typeof payload.key === 'string' ? payload.key : ''
  return {
    id,
    vendor: payload.vendor === 'glm' ? 'glm' : 'deepseek',
    label: typeof payload.label === 'string' && payload.label !== '' ? payload.label : id,
    tail: key.length > 8 ? key.slice(-4) : '',
    key,
  }
}

/** List every key this plugin stores, without exposing values outside the host. */
async function listManagedKeys(ctx) {
  let entries = []
  try {
    entries = await ctx.credentials.listRecords()
  } catch {
    return []
  }
  const views = []
  for (const entry of Array.isArray(entries) ? entries : []) {
    const key = entry && entry.key !== undefined ? String(entry.key) : ''
    if (key === '') continue
    let scope = ''
    let id = ''
    try {
      scope = credentialKeyScope(key)
      id = credentialKeyId(key)
    } catch {
      continue
    }
    if (scope !== RECORD_SCOPE) continue
    let record = null
    try {
      record = await ctx.credentials.readRecord(credentialKey(scope, id))
    } catch {
      continue
    }
    if (record === undefined || record === null) continue
    views.push(recordToView(id, record))
  }
  return views
}

async function addManagedKey(ctx, vendor, label, key) {
  const normalizedVendor = vendor === 'glm' ? 'glm' : 'deepseek'
  const id = newRecordId(normalizedVendor)
  const trimmed = key.trim()
  if (trimmed === '') throw new Error('EMPTY_KEY')
  await ctx.credentials.modifyRecord(credentialKey(RECORD_SCOPE, id), async () => ({
    kind: 'api-key',
    payload: {
      vendor: normalizedVendor,
      label: label.trim() === '' ? id : label.trim(),
      key: trimmed,
    },
  }))
  return id
}

async function removeManagedKey(ctx, id) {
  if (typeof id !== 'string' || id === '') return false
  try {
    await ctx.credentials.deleteRecord(credentialKey(RECORD_SCOPE, id))
    return true
  } catch {
    return false
  }
}

/* ── local DeepSeek spend metering ─────────────────────────────────────── */

/**
 * The DeepSeek balance API exposes no usage history, so today's DeepSeek
 * spend is metered locally: every `llm/stream` call that routes to a DeepSeek
 * provider contributes its usage block, and every recorded search request adds
 * its per-request fee. Token buckets are kept per pricing tier (peak/idle); the
 * amount is computed from the official rate card on read, so a price change or
 * an audit never needs re-charging the ledger. Nothing here performs network
 * I/O; the ledger is a small JSON file under `$DSH_HOME/storages/api-usage/`.
 *
 * Official rates (CNY per 1M tokens, peak = idle × 2):
 *   flash  idle 0.02 / 1 / 4        peak 0.04 / 2 / 8
 *   pro    idle 0.15 / 4.5 / 13.5   peak 0.30 / 9 / 27
 * Peak = Beijing time Mon–Fri 09:00–12:00 and 14:00–18:00, excluding Chinese
 * public holidays (holiday dates are not modelled yet).
 * Search/Fetch server-tool requests are billed per successful request
 * (CNY 5 / 1,000) and are counted per recorded search request as an estimate —
 * the search model's own tokens are not exposed to the Harness, so that part
 * stays unmetered.
 */
const DEEPSEEK_PRICING = {
  flash: {
    idle: { cacheHit: 0.02, cacheMiss: 1, output: 4 },
    peak: { cacheHit: 0.04, cacheMiss: 2, output: 8 },
  },
  pro: {
    idle: { cacheHit: 0.15, cacheMiss: 4.5, output: 13.5 },
    peak: { cacheHit: 0.3, cacheMiss: 9, output: 27 },
  },
}

/** Search/Fetch server-tool request price per successful request (CNY). */
const SEARCH_REQUEST_PRICE = 5 / 1000

/** Ledger schema: v2 stores token buckets by pricing tier. */
const LEDGER_VERSION = 2
const DEFAULT_RETAIN_DAYS = 400
/** Debounced persistence delay: a crash loses at most this much metering. */
const FLUSH_DELAY_MS = 500

/** Stable ledger location; `$DSH_HOME` is set by the harness shell environment. */
function ledgerPaths() {
  const home = typeof process.env.DSH_HOME === 'string' && process.env.DSH_HOME !== ''
    ? process.env.DSH_HOME
    : path.join(os.homedir(), '.dsh')
  const dir = path.join(home, 'storages', 'api-usage')
  return { dir, file: path.join(dir, 'ledger.json') }
}

function localDateKey(date) {
  const pad = (n) => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

/** Beijing-time peak window: Mon–Fri 09:00–12:00 and 14:00–18:00. */
function isPeakNow(date) {
  const beijing = new Date(date.getTime() + 8 * 3600 * 1000)
  const day = beijing.getUTCDay()
  if (day === 0 || day === 6) return false
  const hour = beijing.getUTCHours()
  return (hour >= 9 && hour < 12) || (hour >= 14 && hour < 18)
}

/** Pick the price family ('flash' | 'pro') for a DeepSeek model id. */
function priceFamily(model) {
  const id = typeof model === 'string' ? model.toLowerCase() : ''
  if (id.includes('pro')) return 'pro'
  if (id.includes('flash')) return 'flash'
  return null
}

function isDeepseekProvider(provider, model) {
  const p = typeof provider === 'string' ? provider.toLowerCase() : ''
  if (p.includes('deepseek')) return true
  const m = typeof model === 'string' ? model.toLowerCase() : ''
  return m.startsWith('deepseek')
}

/**
 * Normalize one usage block into counted buckets. The DeepSeek stream reports
 * `{ inputTokens, outputTokens, cacheReadTokens, cacheWriteTokens, totalTokens }`
 * where `inputTokens` is the cache-MISS slice — `inputTokens + cacheReadTokens +
 * cacheWriteTokens + outputTokens === totalTokens` was verified live. Other
 * adapter shapes report a whole-prompt count instead, so both forms are
 * detected rather than assumed.
 */
function extractUsage(chunk) {
  const usage = chunk !== null && typeof chunk === 'object' && chunk.usage !== null && typeof chunk.usage === 'object'
    ? chunk.usage
    : chunk
  const num = (...keys) => {
    for (const key of keys) {
      const value = usage[key]
      if (typeof value === 'number' && Number.isFinite(value)) return value
    }
    return null
  }
  const cacheHit = num('cacheReadTokens', 'cacheRead', 'cacheHitTokens', 'cache_hit_tokens', 'cachedInputTokens', 'promptCacheHitTokens')
  const directMiss = num('cacheMissTokens', 'cache_miss_tokens', 'uncachedInputTokens', 'cacheMiss')
  const inputTokens = num('inputTokens', 'input', 'promptTokens', 'prompt_tokens', 'input_tokens')
  const output = num('outputTokens', 'output', 'completionTokens', 'completion_tokens') ?? 0
  const cacheWrite = num('cacheWriteTokens', 'cacheWrite') ?? 0
  const total = num('totalTokens', 'total')

  let cacheMiss = 0
  if (directMiss !== null) {
    cacheMiss = directMiss
  } else if (inputTokens !== null) {
    const hit = cacheHit ?? 0
    /* A decomposable total proves `inputTokens` is already the miss slice. */
    const decomposes = total !== null
      && Math.abs(total - (inputTokens + hit + cacheWrite + output)) <= 1
    cacheMiss = decomposes ? inputTokens : Math.max(0, inputTokens - hit)
  }

  return {
    cacheHit: cacheHit ?? 0,
    cacheMiss,
    cacheWrite,
    output,
  }
}

const TOKEN_FIELDS = ['cacheHit', 'cacheMiss', 'cacheWrite', 'output']

/** One empty per-tier token bucket. */
function emptyTier() {
  return { cacheHit: 0, cacheMiss: 0, cacheWrite: 0, output: 0, calls: 0 }
}

/** Add one stored token/call bucket into another. */
function addTier(target, source) {
  for (const field of TOKEN_FIELDS) target[field] += toFiniteNumber(source[field])
  target.calls += toFiniteNumber(source.calls)
}

/** Sum every stored bucket of one model entry (new tiers + a migrated v1 day). */
function entryTotals(entry) {
  const totals = { cacheHit: 0, cacheMiss: 0, cacheWrite: 0, output: 0, calls: 0 }
  for (const tier of ['peak', 'off']) {
    const bucket = entry[tier]
    if (bucket !== null && typeof bucket === 'object') addTier(totals, bucket)
  }
  if (entry.legacy !== null && typeof entry.legacy === 'object') addTier(totals, entry.legacy)
  return totals
}

/** Split a `${provider}:${model}` ledger key (model ids never contain ':'). */
function splitModelKey(modelKey) {
  const separator = modelKey.indexOf(':')
  return separator >= 0
    ? { provider: modelKey.slice(0, separator), model: modelKey.slice(separator + 1) }
    : { provider: modelKey, model: '' }
}

/** Price one model entry (CNY) from its stored token buckets. */
function modelEntryCost(modelKey, entry) {
  const family = priceFamily(splitModelKey(modelKey).model)
  let cost = entry.legacy !== null && typeof entry.legacy === 'object'
    ? toFiniteNumber(entry.legacy.costCny)
    : 0
  if (family !== null) {
    const rates = DEEPSEEK_PRICING[family]
    for (const tier of ['peak', 'off']) {
      const tokens = entry[tier]
      if (tokens === null || typeof tokens !== 'object') continue
      const rate = rates[tier === 'peak' ? 'peak' : 'idle']
      cost += (
        toFiniteNumber(tokens.cacheHit) * rate.cacheHit
        + (toFiniteNumber(tokens.cacheMiss) + toFiniteNumber(tokens.cacheWrite)) * rate.cacheMiss
        + toFiniteNumber(tokens.output) * rate.output
      ) / 1_000_000
    }
  }
  return cost
}

/** Empty per-provider aggregate used by day summaries. */
function emptyProviderBucket() {
  return {
    cacheHit: 0, cacheMiss: 0, cacheWrite: 0, output: 0,
    calls: 0, costCny: 0, searchCalls: 0,
  }
}

/** Fold one stored day (token buckets + search requests) into the API shape. */
function summarizeDay(day) {
  const totals = { cacheHit: 0, cacheMiss: 0, cacheWrite: 0, output: 0, calls: 0, searchCalls: 0 }
  let costCny = 0
  const byModel = {}
  const byProvider = {}
  const providerBucket = (provider) => {
    if (byProvider[provider] === undefined) byProvider[provider] = emptyProviderBucket()
    return byProvider[provider]
  }
  const modelEntries = day !== null && typeof day === 'object' && day.byModel !== null && typeof day.byModel === 'object'
    ? Object.entries(day.byModel)
    : []
  for (const [modelKey, entry] of modelEntries) {
    if (entry === null || typeof entry !== 'object') continue
    const tokens = entryTotals(entry)
    for (const field of TOKEN_FIELDS) totals[field] += tokens[field]
    totals.calls += tokens.calls
    const cost = modelEntryCost(modelKey, entry)
    costCny += cost
    byModel[modelKey] = { costCny: cost, calls: tokens.calls }
    const bucket = providerBucket(splitModelKey(modelKey).provider)
    for (const field of TOKEN_FIELDS) bucket[field] += tokens[field]
    bucket.calls += tokens.calls
    bucket.costCny += cost
  }
  const search = day !== null && typeof day === 'object' && day.search !== null && typeof day.search === 'object'
    ? day.search
    : {}
  for (const [provider, record] of Object.entries(search)) {
    if (record === null || typeof record !== 'object') continue
    const requests = toFiniteNumber(record.requests)
    const cost = requests * SEARCH_REQUEST_PRICE
    totals.searchCalls += requests
    costCny += cost
    const bucket = providerBucket(provider)
    bucket.searchCalls += requests
    bucket.costCny += cost
  }
  return { ...totals, costCny, byModel, byProvider }
}

/** Convert a v1 ledger (pre-priced CNY days) into v2 token buckets. */
function migrateLegacyDays(days) {
  const migrated = {}
  for (const [date, day] of Object.entries(days ?? {})) {
    if (day === null || typeof day !== 'object') continue
    const byModel = {}
    const entries = day.byModel !== null && typeof day.byModel === 'object' ? Object.entries(day.byModel) : []
    for (const [modelKey, entry] of entries) {
      if (entry === null || typeof entry !== 'object') continue
      byModel[modelKey] = {
        peak: emptyTier(),
        off: emptyTier(),
        legacy: {
          cacheHit: toFiniteNumber(entry.cacheHit),
          cacheMiss: toFiniteNumber(entry.cacheMiss),
          cacheWrite: toFiniteNumber(entry.cacheWrite),
          output: toFiniteNumber(entry.output),
          calls: toFiniteNumber(entry.calls),
          costCny: toFiniteNumber(entry.costCny),
        },
      }
    }
    migrated[date] = { byModel, search: {} }
  }
  return migrated
}

/**
 * In-memory daily ledger with debounced persistence. Survives restarts; a
 * corrupt file starts fresh rather than failing the plugin.
 *
 * v2 keeps token buckets per peak/idle tier, so the amount is always
 * recomputable: a future price-card change or an audit never has to re-charge
 * the stored data. A v1 file is migrated on load; its already-priced day
 * totals survive as `legacy`.
 */
function createSpendLedger(options = {}) {
  const retainDays = Number.isFinite(options.retainDays)
    ? Math.max(1, Math.floor(options.retainDays))
    : DEFAULT_RETAIN_DAYS
  const state = { days: {}, debugOnce: null }
  const { dir, file } = ledgerPaths()
  let writeTimer = null
  let dirty = false

  load()

  function load() {
    try {
      const raw = fs.readFileSync(file, 'utf8')
      const parsed = JSON.parse(raw)
      if (parsed === null || typeof parsed !== 'object' || parsed.days === null || typeof parsed.days !== 'object') return
      state.days = parsed.version === LEDGER_VERSION ? parsed.days : migrateLegacyDays(parsed.days)
      prune()
    } catch {
      /* first run or unreadable ledger — start clean */
    }
  }

  /** Drop days older than the retention window (default ~13 months). */
  function prune() {
    const cutoff = localDateKey(new Date(Date.now() - (retainDays - 1) * 86400000))
    for (const key of Object.keys(state.days)) if (key < cutoff) delete state.days[key]
  }

  function flush() {
    if (!dirty) return
    dirty = false
    prune()
    try {
      fs.mkdirSync(dir, { recursive: true })
      const tmp = `${file}.tmp`
      fs.writeFileSync(tmp, JSON.stringify({ version: LEDGER_VERSION, days: state.days }))
      fs.renameSync(tmp, file)
    } catch {
      /* best-effort persistence */
    }
  }

  function scheduleFlush() {
    dirty = true
    if (writeTimer !== null) return
    writeTimer = setTimeout(() => {
      writeTimer = null
      flush()
    }, FLUSH_DELAY_MS)
    if (typeof writeTimer.unref === 'function') writeTimer.unref()
  }

  function dayBucket(date) {
    const key = localDateKey(date)
    if (state.days[key] === undefined) {
      state.days[key] = { byModel: {}, search: {} }
    }
    return { key, bucket: state.days[key] }
  }

  return {
    /** Record one completed usage block into its peak/idle token bucket. */
    record(provider, model, usage, at) {
      const family = priceFamily(model)
      if (family === null) return null
      const { bucket } = dayBucket(at)
      const key = `${provider}:${model}`
      const entry = bucket.byModel[key] ?? { peak: emptyTier(), off: emptyTier() }
      const tier = isPeakNow(at) ? 'peak' : 'off'
      const target = entry[tier]
      for (const field of TOKEN_FIELDS) target[field] += toFiniteNumber(usage[field])
      target.calls += 1
      bucket.byModel[key] = entry
      scheduleFlush()
      return { key, tier }
    },
    /** Record one DeepSeek search request (billed per successful request). */
    recordSearch(provider, at) {
      if (typeof provider !== 'string' || provider === '') return
      const { bucket } = dayBucket(at)
      if (bucket.search === undefined) bucket.search = {}
      const record = bucket.search[provider] ?? { requests: 0 }
      record.requests += 1
      bucket.search[provider] = record
      scheduleFlush()
    },
    /** Today's metered total, split per provider, for the settings page. */
    today(now = new Date()) {
      const key = localDateKey(now)
      return { date: key, ...summarizeDay(state.days[key]) }
    },
    /** Last N days, split per provider and per model, for the cards' charts. */
    recent(days = 7, now = new Date()) {
      const out = []
      for (let offset = days - 1; offset >= 0; offset -= 1) {
        const day = new Date(now.getTime() - offset * 86400000)
        const key = localDateKey(day)
        out.push({ date: key, ...summarizeDay(state.days[key]) })
      }
      return out
    },
    /** Daily totals over a longer window (calendar heatmap). */
    daily(days = 90, now = new Date()) {
      const out = []
      for (let offset = days - 1; offset >= 0; offset -= 1) {
        const day = new Date(now.getTime() - offset * 86400000)
        const key = localDateKey(day)
        const summary = summarizeDay(state.days[key])
        out.push({
          date: key,
          costCny: summary.costCny,
          calls: summary.calls,
          searchCalls: summary.searchCalls,
          byProvider: summary.byProvider,
        })
      }
      return out
    },
    flush,
    /** One captured raw usage chunk, exposed for shape diagnostics. */
    noteSample(sample) {
      if (state.debugOnce === null) state.debugOnce = sample
    },
    sample() {
      return state.debugOnce
    },
  }
}

/* ── credential helpers ────────────────────────────────────────────────── */

/** Resolve one source's key value (reference or plugin record). Host-only. */
async function resolveSourceKey(ctx, source) {
  if (source.kind === 'record') {
    try {
      const record = await ctx.credentials.readRecord(credentialKey(RECORD_SCOPE, source.recordId))
      const view = record === undefined || record === null ? null : recordToView(source.recordId, record)
      if (view !== null && view.key !== '') return { configured: true, value: view.key, tail: view.tail }
    } catch {
      /* fall through to unconfigured */
    }
    return { configured: false, value: '', tail: '' }
  }
  try {
    const hit = await ctx.credentials.resolve(credentialRef(source.ref))
    if (hit !== undefined && typeof hit.value === 'string' && hit.value !== '') {
      return { configured: true, value: hit.value, tail: hit.value.length > 8 ? hit.value.slice(-4) : '' }
    }
  } catch {
    /* unknown ref shape or unresolved — reported as unconfigured */
  }
  return { configured: false, value: '', tail: '' }
}

/* ── DeepSeek balance ──────────────────────────────────────────────────── */

async function queryDeepSeek(baseURL, key) {
  const base = baseURL.replace(/\/+$/, '')
  const { ok, status, json, text } = await fetchJson(`${base}/user/balance`, {
    Authorization: `Bearer ${key}`,
    Accept: 'application/json',
  })
  if (!ok) {
    const message = (json && (json.error?.message || json.message)) || text || `HTTP ${status}`
    return { ok: false, error: message }
  }
  return { ok: true, data: json ?? null }
}

/* ── GLM coding plan ───────────────────────────────────────────────────── */

/** GET a GLM monitor endpoint, retrying with a Bearer prefix on auth denial. */
async function glmGet(url, key) {
  const attempt = (authorization) => fetchJson(url, {
    authorization,
    accept: 'application/json',
  })
  let result = await attempt(key)
  if (result.status === 401 || result.status === 403) {
    result = await attempt(`Bearer ${key}`)
  }
  return result
}

function toNumber(value) {
  const n = typeof value === 'number' ? value : typeof value === 'string' && value.trim() !== '' ? Number(value) : NaN
  return Number.isFinite(n) ? n : null
}

/** Non-null finite number, defaulting to zero for ledger sums. */
function toFiniteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

function pickWindow(limit) {
  if (limit === null || typeof limit !== 'object') return null
  return {
    total: toNumber(limit.usage),
    used: toNumber(limit.currentValue),
    remaining: toNumber(limit.remaining),
    percentage: toNumber(limit.percentage),
    nextResetTime: typeof limit.nextResetTime === 'number' && limit.nextResetTime > 0 ? limit.nextResetTime : null,
  }
}

/** Map the quota payload onto named windows keyed by type+unit, never order. */
function parseGlmQuota(json) {
  const data = json !== null && typeof json === 'object' ? json.data : null
  const limits = data !== null && Array.isArray(data.limits) ? data.limits : []
  const windows = { session: null, weekly: null, mcp: null }
  for (const limit of limits) {
    if (limit === null || typeof limit !== 'object') continue
    const type = limit.type
    if (type === 'TOKENS_LIMIT' || type === 'CREDIT_LIMIT') {
      if (limit.unit === 3 && windows.session === null) windows.session = pickWindow(limit)
      else if (limit.unit === 6 && windows.weekly === null) windows.weekly = pickWindow(limit)
    } else if (type === 'TIME_LIMIT' && limit.unit === 5 && windows.mcp === null) {
      windows.mcp = pickWindow(limit)
    }
  }
  return { level: data !== null && typeof data.level === 'string' ? data.level : '', windows }
}

/** `yyyy-MM-dd HH:mm:ss` in the host's local zone, as the monitor API wants. */
function localDateTime(date) {
  const pad = (n) => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
}

/** Today's MODEL credit/token spend from credit-usage/usage-detail. */
async function glmToday(baseURL, key) {
  const base = baseURL.replace(/\/+$/, '')
  const start = new Date()
  start.setHours(0, 0, 0, 0)
  const end = new Date(start.getTime() + 86400000 - 1)
  const query = `usageType=MODEL&startTime=${encodeURIComponent(localDateTime(start))}&endTime=${encodeURIComponent(localDateTime(end))}`
  const { json } = await glmGet(`${base}/api/monitor/credit-usage/usage-detail?${query}`, key)
  if (json === null || json.success !== true) return null
  const data = typeof json.data === 'object' && json.data !== null ? json.data : null
  if (data === null) return null
  const credits = data.summary?.totalCredits?.value
  const tokens = data.modelUsage?.totalUsage?.totalTokens
  const creditsValue = typeof credits === 'string' || typeof credits === 'number' ? String(credits) : null
  const tokensValue = typeof tokens === 'number' ? tokens : null
  if (creditsValue === null && tokensValue === null) return null
  return { credits: creditsValue, tokens: tokensValue }
}

async function queryGlm(baseURL, key) {
  const base = baseURL.replace(/\/+$/, '')
  const { ok, status, json, text } = await glmGet(`${base}/api/monitor/usage/quota/limit`, key)
  const succeeded = json !== null && (json.success === true || json.code === 200)
  if (!ok || !succeeded) {
    const message = (json && json.msg) || text || `HTTP ${status}`
    return { ok: false, error: message, data: null }
  }
  const quota = parseGlmQuota(json)
  let today = null
  try {
    today = await glmToday(baseURL, key)
  } catch {
    today = null
  }
  return { ok: true, data: { ...quota, today } }
}

/* ── signed-in DeepSeek account ────────────────────────────────────────── */

async function queryAccount(ctx) {
  const account = ctx.get('deepseekAccount')
  if (account === undefined) return { available: false, signedIn: false }
  let state = null
  try {
    state = await account.getState()
  } catch {
    return { available: true, signedIn: false }
  }
  const links = state !== null && typeof state === 'object' && state.links !== null && typeof state.links === 'object'
    ? { usageUrl: state.links.usageUrl, topUpUrl: state.links.topUpUrl }
    : null
  if (state === null || state.status !== 'credential-stored') {
    return { available: true, signedIn: false, links }
  }
  const client = {
    version: '1',
    locale: 'zh-CN',
    timezoneOffsetSeconds: -new Date().getTimezoneOffset() * 60,
  }
  const [profile, balance] = await Promise.all([
    account.getProfile(client).catch(() => null),
    account.getBalance(client).catch(() => null),
  ])
  return {
    available: true,
    signedIn: true,
    links,
    profile: profile !== null && profile.status === 'ready' ? profile.value : null,
    balance: balance !== null && balance.status === 'ready'
      ? { value: balance.value, bonusWallets: balance.bonusWallets }
      : null,
  }
}

/* ── plugin entry ──────────────────────────────────────────────────────── */

function apply(ctx, config) {
  const deepseekBase = config.deepseekBaseURL
  const glmBase = config.glmBaseURL

  /* Local DeepSeek spend meter: the balance API has no usage history, so we
   * store the usage blocks the stream reports (plus per-request search fees)
   * in a small daily ledger and price them on read. */
  const spendLedger = createSpendLedger({ retainDays: config.retainDays })

  const disposeMeter = ctx.on('llm/stream', (options, next) => {
    const provider = options !== null && typeof options === 'object' ? options.provider : undefined
    const model = options !== null && typeof options === 'object' ? options.model : undefined
    if (!isDeepseekProvider(provider, model)) return next()
    const upstream = next()
    return (async function* tracked() {
      for await (const chunk of upstream) {
        try {
          if (chunk !== null && typeof chunk === 'object' && chunk.type === 'usage') {
            spendLedger.noteSample({ provider, model, chunk })
            const usage = extractUsage(chunk)
            spendLedger.record(String(provider ?? ''), String(model ?? ''), usage, new Date())
          }
        } catch {
          /* metering must never disturb the model stream */
        }
        yield chunk
      }
    })()
  })

  /* DeepSeek web search is a provider-private Messages call (outside the `llm`
   * seam), so it never reports token usage here. The session records one
   * `web/deepseek-search-llm-request` event per search request; count those and
   * charge the per-request Search fee. The search model's own tokens remain
   * unmetered — the Harness never sees them. */
  const disposeSearchMeter = ctx.on('session/event', (session, event) => {
    try {
      if (event === null || typeof event !== 'object' || event.type !== 'web/deepseek-search-llm-request') return
      const route = typeof session?.requestContext === 'function' ? session.requestContext() : undefined
      const provider = route !== null && typeof route === 'object' && route.provider === 'deepseek-account'
        ? 'deepseek-account'
        : 'deepseek-official'
      spendLedger.recordSearch(provider, new Date(typeof event.time === 'number' ? event.time : Date.now()))
    } catch {
      /* metering must never disturb the session */
    }
  })

  const disposeSummary = ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: '/api-usage/summary',
    handler: async (req, res) => {
      if (req.method !== 'GET') {
        writeJson(res, 405, { ok: false, error: 'METHOD_NOT_ALLOWED' })
        return
      }
      try {
        const { sources, debug } = await discoverSources(ctx, config.extraRefs)

        /* Two providers may share one reference: query each distinct key once. */
        const queried = new Map()
        const queryOnce = (cacheKey, vendor, value) => {
          const cached = queried.get(cacheKey)
          if (cached !== undefined) return cached
          const pending = (vendor === 'deepseek'
            ? queryDeepSeek(deepseekBase, value)
            : queryGlm(glmBase, value)
          ).catch((err) => ({ ok: false, error: err instanceof Error ? err.message : String(err), data: null }))
          queried.set(cacheKey, pending)
          return pending
        }

        const [account, ...keyResults] = await Promise.all([
          queryAccount(ctx),
          ...sources.map(async (source) => {
            const credential = await resolveSourceKey(ctx, source)
            const entry = {
              id: source.id,
              vendor: source.vendor,
              label: source.label,
              keyName: source.ref,
              origin: source.origin,
              kind: source.kind,
              recordId: source.recordId,
              tail: credential.tail !== '' ? credential.tail : (source.tail ?? ''),
              configured: credential.configured,
              ok: false,
              data: null,
              error: null,
            }
            if (!credential.configured) {
              entry.error = 'MISSING_CREDENTIAL'
              return entry
            }
            try {
              const result = await queryOnce(
                source.kind === 'record' ? `record:${source.recordId}` : `ref:${source.ref}`,
                source.vendor,
                credential.value,
              )
              entry.ok = result.ok
              entry.data = result.ok ? result.data : null
              entry.error = result.ok ? null : result.error
            } catch (err) {
              entry.error = err instanceof Error ? err.message : String(err)
            }
            return entry
          }),
        ])

        /* Per-source spend: the account route and each API-key route are
         * separate cost centres, so every row carries its own day figure. */
        const spendToday = spendLedger.today()
        const byProvider = spendToday.byProvider ?? {}
        const spendFor = (providerIds) => {
          let costCny = 0
          let calls = 0
          let searchCalls = 0
          const tokens = { cacheHit: 0, cacheMiss: 0, cacheWrite: 0, output: 0 }
          for (const providerId of providerIds) {
            const bucket = byProvider[providerId]
            if (bucket === undefined) continue
            costCny += toFiniteNumber(bucket.costCny)
            calls += toFiniteNumber(bucket.calls)
            searchCalls += toFiniteNumber(bucket.searchCalls)
            for (const field of TOKEN_FIELDS) tokens[field] += toFiniteNumber(bucket[field])
          }
          return calls > 0 || costCny > 0 || searchCalls > 0
            ? {
                costCny,
                calls,
                searchCalls,
                /* Token split mirrors the price components: `input` is the
                 * miss-rate slice (uncached prompt + cache writes), `cacheHit`
                 * the hit-rate slice, `output` the completion tokens. */
                tokens: {
                  input: tokens.cacheMiss + tokens.cacheWrite,
                  cacheHit: tokens.cacheHit,
                  output: tokens.output,
                },
              }
            : null
        }

        writeJson(res, 200, {
          ok: true,
          fetchedAt: new Date().toISOString(),
          pollSeconds: config.pollSeconds,
          lowBalance: config.lowBalance,
          footerStyle: config.footerStyle,
          selectedSource: config.selectedSource,
          hidden: Array.isArray(config.hidden) ? config.hidden : [],
          deepseek: keyResults
            .filter((entry) => entry.vendor === 'deepseek')
            .map((entry) => ({ ...entry, spend: spendFor([entry.origin]) })),
          glm: keyResults.filter((entry) => entry.vendor === 'glm'),
          account: {
            ...account,
            spend: spendFor(['deepseek-account']),
          },
          spend: {
            today: spendToday,
            recent: spendLedger.recent(7),
            calendar: spendLedger.daily(90),
            sample: spendLedger.sample(),
          },
          debug,
        })
      } catch (err) {
        writeJson(res, 200, {
          ok: false,
          error: 'TRANSPORT',
          message: err instanceof Error ? err.message : String(err),
        })
      }
    },
  }), 'api-usage: summary route')

  const disposeVisibility = ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: '/api-usage/visibility',
    handler: async (req, res) => {
      if (req.method !== 'POST') {
        writeJson(res, 405, { ok: false, error: 'METHOD_NOT_ALLOWED' })
        return
      }
      const body = await readBody(req)
      const id = typeof body.id === 'string' && body.id !== '' ? body.id : null
      if (id === null) {
        writeJson(res, 200, { ok: false, error: 'BAD_REQUEST' })
        return
      }
      const entry = ctx.fiber.entry
      const editor = ctx.get('configEditor')
      if (entry === undefined || editor === undefined) {
        writeJson(res, 200, { ok: false, error: 'CONFIG_UNAVAILABLE' })
        return
      }
      try {
        await editor.edit(entry, (current) => {
          const hidden = Array.isArray(current.hidden) ? current.hidden.filter((x) => x !== id) : []
          return { ...current, hidden: body.visible === false ? [...hidden, id] : hidden }
        })
        writeJson(res, 200, { ok: true })
      } catch (err) {
        writeJson(res, 200, {
          ok: false,
          error: 'WRITE_FAILED',
          message: err instanceof Error ? err.message : String(err),
        })
      }
    },
  }), 'api-usage: visibility route')

  /* Choose which source the composer badge shows ('' = signed-in account). */
  const disposeSelection = ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: '/api-usage/selection',
    handler: async (req, res) => {
      if (req.method !== 'POST') {
        writeJson(res, 405, { ok: false, error: 'METHOD_NOT_ALLOWED' })
        return
      }
      const body = await readBody(req)
      const selected = typeof body.id === 'string' ? body.id : ''
      const entry = ctx.fiber.entry
      const editor = ctx.get('configEditor')
      if (entry === undefined || editor === undefined) {
        writeJson(res, 200, { ok: false, error: 'CONFIG_UNAVAILABLE' })
        return
      }
      try {
        await editor.edit(entry, (current) => ({ ...current, selectedSource: selected }))
        writeJson(res, 200, { ok: true, selectedSource: selected })
      } catch (err) {
        writeJson(res, 200, {
          ok: false,
          error: 'WRITE_FAILED',
          message: err instanceof Error ? err.message : String(err),
        })
      }
    },
  }), 'api-usage: selection route')

  const disposeKeys = ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: '/api-usage/keys',
    handler: async (req, res) => {
      try {
        if (req.method === 'GET') {
          const keys = await listManagedKeys(ctx)
          writeJson(res, 200, {
            ok: true,
            keys: keys.map((entry) => ({
              id: entry.id,
              vendor: entry.vendor,
              label: entry.label,
              tail: entry.tail,
            })),
          })
          return
        }
        if (req.method !== 'POST') {
          writeJson(res, 405, { ok: false, error: 'METHOD_NOT_ALLOWED' })
          return
        }
        const body = await readBody(req)
        const action = typeof body.action === 'string' ? body.action : ''
        if (action === 'add') {
          const key = typeof body.key === 'string' ? body.key : ''
          if (key.trim() === '') {
            writeJson(res, 200, { ok: false, error: 'EMPTY_KEY' })
            return
          }
          const id = await addManagedKey(
            ctx,
            body.vendor === 'glm' ? 'glm' : 'deepseek',
            typeof body.label === 'string' ? body.label : '',
            key,
          )
          writeJson(res, 200, { ok: true, id })
          return
        }
        if (action === 'remove') {
          const removed = await removeManagedKey(ctx, typeof body.id === 'string' ? body.id : '')
          writeJson(res, 200, { ok: removed, error: removed ? null : 'NOT_FOUND' })
          return
        }
        writeJson(res, 200, { ok: false, error: 'UNKNOWN_ACTION' })
      } catch (err) {
        writeJson(res, 200, {
          ok: false,
          error: 'KEYS_FAILED',
          message: err instanceof Error ? err.message : String(err),
        })
      }
    },
  }), 'api-usage: keys route')

  return () => {
    try {
      spendLedger.flush()
    } catch {
      /* best-effort persistence on unload */
    }
    disposeMeter()
    disposeSearchMeter()
    disposeSelection()
    disposeKeys()
    disposeVisibility()
    disposeSummary()
  }
}

export { Config, apply, inject, name }

import os from 'node:os'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'

const TIMEOUT_MS = 12000
const MAX_OUTPUT_BYTES = 256 * 1024

function resolveCodex(command) {
  if (typeof command === 'string' && command.trim() !== '') {
    const executable = command.trim()
    return executable.endsWith('.js')
      ? { executable: 'node', args: [executable, 'app-server'] }
      : { executable, args: ['app-server'] }
  }

  const home = process.env.DSH_HOME || path.join(os.homedir(), '.dsh')
  const candidateProfiles = [process.env.DSH_PROFILE_DIR, path.join(home, 'profiles', 'desktop')]
  for (const profile of candidateProfiles) {
    if (!profile) continue
    try {
      const require = createRequire(path.join(profile, 'package.json'))
      const script = require.resolve('@openai/codex/bin/codex.js')
      return { executable: 'node', args: [script, 'app-server'] }
    } catch {
      // This profile need not include the Codex subagent bundle.
    }
  }
  try {
    const require = createRequire(import.meta.url)
    const script = require.resolve('@openai/codex/bin/codex.js')
    return { executable: 'node', args: [script, 'app-server'] }
  } catch {
    return { executable: 'codex', args: ['app-server'] }
  }
}

function percent(value) {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.max(0, Math.min(100, value)) : null
}

function windowOf(value) {
  if (value === null || typeof value !== 'object') return null
  const usedPercent = percent(value.usedPercent)
  if (usedPercent === null) return null
  return {
    usedPercent,
    windowDurationMins: Number.isFinite(value.windowDurationMins) ? value.windowDurationMins : null,
    resetsAt: Number.isFinite(value.resetsAt) ? value.resetsAt : null,
  }
}

/** Strip everything except the quota facts the browser needs. Never forward account IDs or tokens. */
export function normalizeCodexUsage(response) {
  if (response === null || typeof response !== 'object') throw new Error('INVALID_RESULT')
  const limits = response.rateLimitsByLimitId
  const snapshot = limits && typeof limits === 'object' && !Array.isArray(limits)
    ? limits.codex ?? response.rateLimits : response.rateLimits
  if (snapshot === null || typeof snapshot !== 'object') throw new Error('INVALID_RESULT')
  const credits = snapshot.credits && typeof snapshot.credits === 'object' ? snapshot.credits : null
  return {
    planType: typeof snapshot.planType === 'string' ? snapshot.planType : null,
    primary: windowOf(snapshot.primary),
    secondary: windowOf(snapshot.secondary),
    credits: credits ? {
      balance: typeof credits.balance === 'string' ? credits.balance : null,
      hasCredits: credits.hasCredits === true,
      unlimited: credits.unlimited === true,
    } : null,
  }
}

/** Query the official local Codex app-server, which owns login and token refresh. */
export async function queryCodexUsage(command = '') {
  const { executable, args } = resolveCodex(command)
  return new Promise((resolve) => {
    let settled = false
    let initialized = false
    let signedIn = false
    let bytes = 0
    let buffer = ''
    let child
    const finish = (result) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      if (child && !child.killed) child.kill()
      resolve(result)
    }
    const fail = (code) => finish({ available: code !== 'CODEX_NOT_FOUND', signedIn, ok: false, error: code })
    const timer = setTimeout(() => fail('TIMEOUT'), TIMEOUT_MS)
    timer.unref?.()
    try {
      child = spawn(executable, args, {
        stdio: ['pipe', 'pipe', 'ignore'],
        windowsHide: true,
        env: process.env,
      })
    } catch {
      fail('CODEX_NOT_FOUND')
      return
    }
    child.on('error', (err) => fail(err && err.code === 'ENOENT' ? 'CODEX_NOT_FOUND' : 'CODEX_UNAVAILABLE'))
    child.on('exit', () => fail('CODEX_UNAVAILABLE'))
    child.stdin.on('error', () => fail('CODEX_UNAVAILABLE'))
    const send = (message) => {
      if (settled) return
      try { child.stdin.write(`${JSON.stringify(message)}\n`) } catch { fail('CODEX_UNAVAILABLE') }
    }
    child.stdout.on('data', (chunk) => {
      bytes += chunk.length
      if (bytes > MAX_OUTPUT_BYTES) { fail('INVALID_RESULT'); return }
      buffer += chunk.toString('utf8')
      let newline
      while (!settled && (newline = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, newline).trim()
        buffer = buffer.slice(newline + 1)
        if (!line) continue
        let message
        try { message = JSON.parse(line) } catch { continue }
        if (message.id === 1 && !initialized) {
          if (message.error) { fail('CODEX_UNAVAILABLE'); return }
          initialized = true
          send({ method: 'initialized' })
          send({ id: 2, method: 'account/read', params: { refreshToken: false } })
        } else if (message.id === 2) {
          if (message.error) { fail('CODEX_UNAVAILABLE'); return }
          const account = message.result && message.result.account
          if (!account || account.type !== 'chatgpt') {
            finish({ available: true, signedIn: false, ok: false, error: 'CHATGPT_LOGIN_REQUIRED' })
            return
          }
          signedIn = true
          send({ id: 3, method: 'account/rateLimits/read' })
        } else if (message.id === 3) {
          if (message.error) { fail('USAGE_UNAVAILABLE'); return }
          try {
            finish({ available: true, signedIn: true, ok: true, data: normalizeCodexUsage(message.result) })
          } catch {
            finish({ available: true, signedIn: true, ok: false, error: 'INVALID_RESULT' })
          }
        }
      }
    })
    send({ id: 1, method: 'initialize', params: { clientInfo: { name: 'dsh-api-usage', version: '0.3.0' } } })
  })
}

const mode = process.env.FAKE_CODEX_MODE || 'success'
let buffer = ''
process.stdin.on('data', (chunk) => {
  buffer += chunk.toString()
  let end
  while ((end = buffer.indexOf('\n')) !== -1) {
    const line = buffer.slice(0, end)
    buffer = buffer.slice(end + 1)
    const request = JSON.parse(line)
    if (request.id === 1) {
      process.stdout.write(JSON.stringify({ id: 100, method: 'unrelated' }) + '\n')
      process.stdout.write(JSON.stringify({ id: 1, result: { userAgent: 'test' } }) + '\n')
    } else if (request.id === 2) {
      const type = mode === 'apiKey' ? 'apiKey' : mode === 'signedOut' ? null : 'chatgpt'
      process.stdout.write(JSON.stringify({ id: 2, result: { account: type ? { type } : null } }) + '\n')
    } else if (request.id === 3) {
      if (mode === 'offline') {
        process.stdout.write(JSON.stringify({ id: 3, error: { message: 'private backend diagnostic' } }) + '\n')
      } else {
        const response = { id: 3, result: { accountId: 'DO-NOT-LEAK', rateLimits: {
          primary: { usedPercent: 10, windowDurationMins: 300, resetsAt: 1 },
        }, rateLimitsByLimitId: { codex: {
          planType: 'plus', primary: { usedPercent: 75, windowDurationMins: 300, resetsAt: 2000000000 },
          secondary: { usedPercent: 20, windowDurationMins: 10080, resetsAt: 2000100000 },
          credits: { hasCredits: true, unlimited: false, balance: '6.5' },
        } } } }
        process.stdout.write(JSON.stringify(response) + '\n')
      }
    }
  }
})

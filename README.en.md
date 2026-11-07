# dsh-api-usage

A DeepSeek Harness (dsh) plugin that shows a **DeepSeek balance / GLM Coding Plan quota** badge in the composer tool row, with per-key usage management and charts.

| Badge and source panel | Management dialog |
| :---: | :---: |
| ![Badge and source panel](docs/screenshot-badge.png) | ![Management dialog](docs/screenshot-manager.png) |

## Features

### Badge (composer tool row)

One compact badge showing the **currently selected source**:

```
📊 ≈¥9,999.99/¥9,999,999.00   ← DeepSeek: today's spend / balance
📊 888/12,000                 ← GLM: 5-hour window used / total
📊 Not selected               ← nothing to show
```

- Selection: manual choice > **signed-in DeepSeek account by default** > none
- Click the badge to refresh
- Hover for 300ms opens the **source panel** (fade-in), where clicking a row switches the badge subject; the "Manage" button in the corner opens the management dialog
- The choice is stored in the browser (instant switching) and synced to plugin config in the background

### Management dialog / Settings page (one shared UI)

- Settings → "API usage", or the "Manage" button in the badge panel (a `shell.overlay` dialog)

One card per source, all with the same structure:

```
★  🔑 DeepSeek  ···xxxx              ¥9,999,999.00   ☆  ●
   ≈¥9,999.99 · 888 calls · available · granted ¥0 · topped up ¥9,999,999.00
   [last 7 days bars]  [last 90 days calendar heatmap]
```

- **Card header**: star (badge subject), source icon/avatar, name, masked key tail, balance, visibility switch
- **Spend line**: today's spend, call count, availability, granted/topped-up balance
- **Charts**: ECharts bar chart (7 days) + GitHub-style calendar heatmap (90 days, week × weekday with month labels)
- **GLM cards**: progress bars for the 5-hour / weekly / MCP quotas (percentage, reset countdown) plus today's official spend (credits/tokens)
- Each source can be toggled independently

### API key management

- **Auto-discovery**: reads `apiKeyEnv` references from your LLM provider configuration
- **Manual keys**: "Add API key" stores additional DeepSeek / GLM keys in the DSH credential store (never in a config file)
- Each key has its own balance/quota, charts, and removal

## Data sources

| Vendor | Endpoint | Auth | Notes |
| --- | --- | --- | --- |
| DeepSeek | `GET https://api.deepseek.com/user/balance` | API key | official balance endpoint |
| DeepSeek account | Host `deepseekAccount` service | DSH session | profile and wallet balances |
| GLM Coding Plan | `GET {host}/api/monitor/usage/quota/limit` | Coding key | 5-hour / weekly / MCP quotas, plan level, reset times |
| GLM Coding Plan | `GET {host}/api/monitor/credit-usage/usage-detail` | Coding key | today's model spend (credits / tokens) |

The GLM host defaults to `https://open.bigmodel.cn`; set `glmBaseURL` to `https://api.z.ai` internationally.

### DeepSeek today's spend (local metering)

DeepSeek exposes **no public usage API**, so the plugin listens to `llm/stream` on the Host and records every usage block per day; web-search requests are billed per request and counted too. Amounts are computed from the official rate card at read time:

```
usage chunk → { inputTokens (cache miss), cacheReadTokens (hit), outputTokens }
            → accumulated into peak / idle token buckets (priced on read)
            → split by provider route (account vs each API key)
            → persisted to $DSH_HOME/storages/api-usage/ledger.json (v2: token buckets)
```

- Covers **DSH's own calls only**; consumption by other clients on the same account is not included
- Built-in rate cards for `deepseek-flash` and `deepseek-v4-pro` (peak = idle × 2; peak is Beijing Mon–Fri 09:00–12:00 and 14:00–18:00; Chinese public holidays are not modelled yet)
- Web search: DSH searches through a DeepSeek Messages `web_search` server tool; the plugin counts `web/deepseek-search-llm-request` session events and estimates **CNY 5 / 1,000** requests. The search model's own tokens are not observable from the Harness and stay unmetered
- The ledger stores only token buckets; amounts are computed on read, so new data follows an official price change automatically (already-priced data migrated from v1 keeps its value)
- The last 400 days are kept by default (`retainDays`); the account route and each API-key route are metered **separately**

## Install

```bash
dsh plugin --profile desktop add github:Alfen2309/dsh-api-usage
```

Local development (linked install, edits take effect immediately):

```powershell
dsh plugin --profile desktop add "link:C:\MY\project\dsh-plugins\dsh-api-usage"
```

## Configuration

| Option | Default | Description |
| --- | --- | --- |
| `deepseekBaseURL` | `https://api.deepseek.com` | DeepSeek API base |
| `glmBaseURL` | `https://open.bigmodel.cn` | GLM API base (use `https://api.z.ai` internationally) |
| `pollSeconds` | `60` | refresh interval |
| `lowBalance` | `20` | low-balance threshold |
| `retainDays` | `400` | days of local ledger history kept (older days are pruned) |
| `selectedSource` | `""` | badge subject id (browser-local wins) |
| `hidden` | `[]` | sources excluded from badge aggregation |
| `extraRefs` | `[]` | extra credential references |

## Development

```bash
npm install          # echarts + esbuild
npm run build        # bundle client.js with inlined ECharts (no CDN)
npm run check        # syntax check
```

- Source lives in `src/client.js`; `client.js` is the build output
- ECharts is registered on demand: `BarChart`, `HeatmapChart`, `CalendarComponent`, `VisualMapComponent`, `CanvasRenderer`
- Client changes require a **DSH application restart** to reload

## Security

- API keys are resolved and used only in the **Host process**; they never reach the browser
- The browser receives balances, quotas, usage and a 4-character key tail only
- Responses carry `Cache-Control: no-store`

## Known limitations

- DSH credential references are not enumerable: the plugin infers them from provider configuration, the `llm` directory and well-known names; use "Add API key" or `extraRefs` for the rest
- Providers pointing at the same `apiKeyEnv` are one key in DSH, so their balances match
- DeepSeek today's spend is a local estimate covering DSH calls only
- Metering starts when the plugin loads, so an install/restart day can read low; web search is estimated per request (its model tokens are unmetered); Chinese public holidays are not treated as off-peak
- GLM Coding Plan is a subscription; the plugin shows quota utilisation instead of a balance
- The DSH settings dialog cannot be opened programmatically by a plugin (no public API), so management uses the plugin's own dialog

## License

MIT

import * as echarts from 'echarts/core'
import { BarChart, HeatmapChart } from 'echarts/charts'
import { CalendarComponent, GridComponent, TooltipComponent, VisualMapComponent } from 'echarts/components'
import { CanvasRenderer } from 'echarts/renderers'

echarts.use([BarChart, HeatmapChart, CalendarComponent, GridComponent, TooltipComponent, VisualMapComponent, CanvasRenderer])

/**
 * dsh-api-usage — client half.
 *
 * One compact badge in the composer tool row plus a management page in
 * Settings. The badge shows a single selected source as `≈today/balance`
 * (DeepSeek) or `used/total` (GLM); hovering it opens an interactive panel
 * listing every source, where clicking a row makes it the badge subject.
 * Anything wider than the badge lives in Settings → API usage.
 *
 * ECharts is bundled at build time (no CDN): the settings cards use a small
 * bar sparkline, so only the bar chart, grid, tooltip and canvas renderer are
 * registered.
 */
window.__ModuleLoader__.load({
  id: 'dsh-api-usage',
  factory(require) {
    const React = require('react')
    const h = React.createElement

    /* A `position: fixed` panel inside the composer is positioned against a
     * transformed ancestor rather than the viewport, which offsets it. Portal
     * the panel to <body> when react-dom is available so its coordinates are
     * true viewport coordinates; otherwise it falls back to in-place render. */
    let createPortal = null
    try {
      const ReactDOM = require('react-dom')
      if (ReactDOM !== null && ReactDOM !== undefined && typeof ReactDOM.createPortal === 'function') {
        createPortal = (node, container) => ReactDOM.createPortal(node, container)
      }
    } catch {
      createPortal = null
    }

    /* ── locale ────────────────────────────────────────────────────────── */

    const ZH = {
      'footer.aria': 'API 余额与用量',
      'footer.error': 'API 用量查询失败：{message}',
      'footer.refresh': '点击立即刷新',
      'settings.title': 'API 用量',
      'settings.refresh': '立即刷新',
      'settings.refreshing': '刷新中…',
      'settings.updated': '更新于 {time}',
      'settings.failed': '查询失败：{message}',
      'account.title': '登录账号',
      'account.signedOut': '未登录 DeepSeek 账号',
      'account.unavailable': '账号服务不可用',
      'account.wallet': '{currency} {balance}',
      'account.bonus': '赠金钱包',
      'account.usage': '用量页',
      'account.topUp': '充值',
      'key.granted': '赠金 {value}',
      'key.topped': '充值余额 {value}',
      'key.available': '可用',
      'key.unavailable': '不可用',
      'key.missing': '未配置 API key',
      'glm.level': 'GLM Coding {level}',
      'glm.window5h': '5 小时窗口',
      'glm.weekly': '周配额',
      'glm.mcp': 'MCP 工具',
      'glm.quota': '{used} / {total} 积分',
      'glm.quotaCalls': '{used} / {total} 次',
      'glm.today': '今日消耗',
      'glm.todayCredits': '{credits} 积分',
      'glm.todayTokens': '{tokens} tokens',
      'glm.resetIn': '{time} 后重置',
      'glm.noPlan': '暂无有效 Coding Plan',
      'spend.title': 'DeepSeek 今日消耗（本地记账）',
      'spend.hint': 'DeepSeek 官方没有用量接口，这里按 DSH 实际调用上报的 token 用量 × 官方价目表在本地估算，只统计 DSH 自身的调用，不包含其它客户端。',
      'spend.cost': '¥{amount}',
      'spend.calls': '{calls} 次调用',
      'spend.tokens': '输入 {input} · 输出 {output}',
      'spend.cache': '缓存命中 {hit}',
      'spend.recent': '近 7 天',
      'spend.calendar': '近 90 天',
      'spend.recentEmpty': '近 90 天没有消耗记录',
      'spend.empty': '今天还没有 DeepSeek 调用',
      'spend.footer': 'DS 今日消耗',
      'badge.title': 'API 用量',
      'badge.none': '未选中',
      'badge.hint': '点击某行设为徽标显示',
      'badge.openSettings': '管理',
      'toggle.label': '计入徽标聚合',
      'sources.title': '数据源',
      'sources.hint': '数据源自动来自 LLM provider 配置中的 apiKeyEnv 引用（DeepSeek / GLM 各自识别）；未绑定 provider 的引用可在本插件的配置 extraRefs 中补充。开关状态保存在插件配置中，所有浏览器同步。',
      'sources.count': '{count} 个',
      'sources.empty': '尚无数据源',
      'keys.title': '添加 API key',
      'keys.hint': '给插件添加额外的 DeepSeek / GLM key（不属于 LLM provider 配置里的那些）。key 保存在 DSH 凭据库里，不会出现在配置文件中，也不会离开本机。',
      'keys.labelPlaceholder': '备注名（可选，如：备用账号）',
      'keys.keyPlaceholder': '粘贴 API key',
      'keys.add': '添加',
      'keys.adding': '添加中…',
      'keys.remove': '删除',
      'keys.managed': '插件内 key',
      'keys.empty': '尚未添加额外 key',
      'keys.saved': '已保存：{label}',
      'keys.removed': '已删除',
      'keys.failed': '操作失败：{message}',
      'vendor.deepseek': 'DeepSeek',
      'vendor.glm': 'GLM',
      'manager.close': '关闭',
      'badge.select': '设为徽标',
      'state.loading': '加载中…',
    }
    const EN = {
      'footer.aria': 'API balance & usage',
      'footer.error': 'API usage query failed: {message}',
      'footer.refresh': 'Click to refresh',
      'settings.title': 'API usage',
      'settings.refresh': 'Refresh now',
      'settings.refreshing': 'Refreshing…',
      'settings.updated': 'Updated {time}',
      'settings.failed': 'Query failed: {message}',
      'account.title': 'Signed-in account',
      'account.signedOut': 'Not signed in to a DeepSeek account',
      'account.unavailable': 'Account service unavailable',
      'account.wallet': '{currency} {balance}',
      'account.bonus': 'Bonus wallets',
      'account.usage': 'Usage',
      'account.topUp': 'Top up',
      'key.granted': 'Granted {value}',
      'key.topped': 'Topped up {value}',
      'key.available': 'available',
      'key.unavailable': 'unavailable',
      'key.missing': 'API key not configured',
      'glm.level': 'GLM Coding {level}',
      'glm.window5h': '5-hour window',
      'glm.weekly': 'Weekly quota',
      'glm.mcp': 'MCP tools',
      'glm.quota': '{used} / {total} credits',
      'glm.quotaCalls': '{used} / {total} calls',
      'glm.today': "Today's spend",
      'glm.todayCredits': '{credits} credits',
      'glm.todayTokens': '{tokens} tokens',
      'glm.resetIn': 'resets in {time}',
      'glm.noPlan': 'No active Coding Plan',
      'spend.title': "DeepSeek today's spend (local meter)",
      'spend.hint': 'DeepSeek exposes no usage API. This figure is estimated locally from the token usage DSH itself reports, priced against the official rate card; calls made by other clients on the same account are not included.',
      'spend.cost': '¥{amount}',
      'spend.calls': '{calls} calls',
      'spend.tokens': 'input {input} · output {output}',
      'spend.cache': 'cache hits {hit}',
      'spend.recent': 'Last 7 days',
      'spend.calendar': 'Last 90 days',
      'spend.recentEmpty': 'No spend in the last 90 days',
      'spend.empty': 'No DeepSeek calls today yet',
      'spend.footer': 'DS today',
      'badge.title': 'API usage',
      'badge.none': 'Not selected',
      'badge.hint': 'Click a row to show it on the badge',
      'badge.openSettings': 'Manage',
      'toggle.label': 'Include in badge aggregation',
      'sources.title': 'Data sources',
      'sources.hint': 'Sources are discovered automatically from apiKeyEnv references in your LLM provider configuration (DeepSeek / GLM). References not bound to a provider can be added via this plugin\'s extraRefs config. Switches persist in plugin config and sync across browsers.',
      'sources.count': '{count}',
      'sources.empty': 'No data sources yet',
      'keys.title': 'Add an API key',
      'keys.hint': 'Add extra DeepSeek / GLM keys beyond the ones your LLM provider configuration references. Keys live in the DSH credential store — never in a config file, and never off this machine.',
      'keys.labelPlaceholder': 'Label (optional, e.g. backup account)',
      'keys.keyPlaceholder': 'Paste an API key',
      'keys.add': 'Add',
      'keys.adding': 'Adding…',
      'keys.remove': 'Remove',
      'keys.managed': 'Plugin-managed keys',
      'keys.empty': 'No extra keys yet',
      'keys.saved': 'Saved: {label}',
      'keys.removed': 'Removed',
      'keys.failed': 'Failed: {message}',
      'vendor.deepseek': 'DeepSeek',
      'vendor.glm': 'GLM',
      'manager.close': 'Close',
      'badge.select': 'Show on badge',
      'state.loading': 'Loading…',
    }

    /* ── styles ────────────────────────────────────────────────────────── */

    const css = [
      /* badge in the composer tool row */
      '.dauw-badge-wrap{position:relative;display:inline-flex;flex:none;align-items:center}',
      '.dauw-badge{display:inline-flex;align-items:center;gap:6px;box-sizing:border-box;height:30px;padding:0 10px;border:none;border-radius:9px;background:transparent;color:var(--dsw-alias-label-secondary,#666);cursor:pointer;font-family:var(--dsw-font,inherit);font-size:13px;font-variant-numeric:tabular-nums;white-space:nowrap;transition:background 120ms ease,color 120ms ease}',
      '.dauw-badge:hover{background:var(--dsw-alias-interactive-bg-hover,#f0f0f0);color:var(--dsw-alias-label-primary,#111)}',
      '.dauw-badge:focus-visible{outline:1px solid var(--dsw-alias-brand-primary,#247bbf);outline-offset:1px}',
      '.dauw-badge-bad{color:var(--dsw-alias-state-error-primary,#d33)}',
      '.dauw-badge-text{font-variant-numeric:tabular-nums}',
      /* interactive hover panel */
      '.dauw-panel{min-width:280px;max-width:360px;max-height:min(64vh,420px);overflow-y:auto;box-sizing:border-box;background:var(--dsw-alias-bg-overlay,#fff);border:0.5px solid var(--dsw-alias-border-l2,#ccc);border-radius:12px;box-shadow:0 12px 32px rgba(0,0,0,.22);padding:8px;z-index:400;font-family:var(--dsw-font,inherit);font-size:13px;color:var(--dsw-alias-label-primary,#111);animation:dauw-fade-up 160ms ease-out;transform-origin:bottom left}',
      '@keyframes dauw-fade-up{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:translateY(0)}}',
      '.dauw-panel-head{flex:none;padding:6px 10px 8px;color:var(--dsw-alias-label-tertiary,#999);font-size:12px}',
      '.dauw-panel-empty{padding:10px;color:var(--dsw-alias-label-secondary,#666)}',
      '.dauw-panel-row{display:flex;align-items:center;gap:9px;width:100%;box-sizing:border-box;border:none;background:transparent;border-radius:9px;padding:8px 10px;cursor:pointer;font-family:inherit;font-size:13px;color:inherit;text-align:left}',
      '.dauw-panel-row:hover{background:var(--dsw-alias-bg-layer-2,#f0f0f0)}',
      '.dauw-panel-row-active{background:var(--dsw-alias-bg-layer-2,#f2f2f2)}',
      '.dauw-panel-radio{flex:none;width:14px;height:14px;border-radius:50%;border:1.5px solid var(--dsw-alias-border-l2,#bbb);box-sizing:border-box;display:inline-flex;align-items:center;justify-content:center}',
      '.dauw-panel-row-active .dauw-panel-radio{border-color:var(--dsw-alias-brand-primary,#247bbf)}',
      '.dauw-panel-radio-dot{width:7px;height:7px;border-radius:50%;background:var(--dsw-alias-brand-primary,#247bbf)}',
      '.dauw-panel-icon{flex:none;display:inline-flex;opacity:.75}',
      '.dauw-panel-name{flex:1 1 auto;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
      '.dauw-panel-value{flex:none;font-variant-numeric:tabular-nums;font-weight:600;font-size:13px}',
      '.dauw-panel-value.dauw-warn{color:#b98216}',
      '.dauw-panel-value.dauw-bad{color:var(--dsw-alias-state-error-primary,#d33)}',
      '.dauw-panel-hint{padding:8px 10px 6px;color:var(--dsw-alias-label-tertiary,#999);font-size:11.5px;border-top:0.5px solid var(--dsw-alias-border-l1,#eee);margin-top:6px}',
      '.dauw-panel-foot{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-top:6px;padding:6px 4px 2px;border-top:0.5px solid var(--dsw-alias-border-l1,#eee)}',
      '.dauw-panel-hint-text{flex:1 1 auto;min-width:0;color:var(--dsw-alias-label-tertiary,#999);font-size:11px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
      '.dauw-panel-action{flex:none;display:inline-flex;align-items:center;height:24px;padding:0 10px;border:none;border-radius:6px;background:var(--dsw-alias-bg-layer-2,#f0f0f0);color:var(--dsw-alias-label-primary,#111);font-size:11.5px;font-family:inherit;cursor:pointer}',
      '.dauw-panel-action:hover{background:var(--dsw-alias-interactive-bg-hover,#e4e4e4)}',
      /* manager dialog (shell.overlay) */
      '.dauw-modal-mask{position:fixed;inset:0;z-index:900;background:rgba(15,18,24,.45);display:flex;align-items:center;justify-content:center;padding:24px;animation:dauw-fade-up 140ms ease-out}',
      '.dauw-modal{position:relative;display:flex;flex-direction:column;width:min(860px,100%);max-height:min(86vh,860px);box-sizing:border-box;background:var(--dsw-alias-bg-layer-1,#fff);border:0.5px solid var(--dsw-alias-border-l2,#ccc);border-radius:14px;box-shadow:0 24px 64px rgba(0,0,0,.32);overflow:hidden;font-family:var(--dsw-font,inherit)}',
      '.dauw-modal-head{flex:none;display:flex;align-items:center;justify-content:space-between;gap:12px;padding:14px 18px;border-bottom:0.5px solid var(--dsw-alias-border-l1,#eee)}',
      '.dauw-modal-title{margin:0;font-size:15px;font-weight:600;color:var(--dsw-alias-label-primary,#111)}',
      '.dauw-modal-close{width:28px;height:28px;display:inline-flex;align-items:center;justify-content:center;border:none;border-radius:8px;background:transparent;color:var(--dsw-alias-label-secondary,#666);font-size:14px;cursor:pointer}',
      '.dauw-modal-close:hover{background:var(--dsw-alias-bg-layer-2,#f0f0f0);color:var(--dsw-alias-label-primary,#111)}',
      '.dauw-modal-body{flex:1 1 auto;min-height:0;overflow-y:auto;padding:16px 18px 20px}',
      /* The settings page caps its own width for the settings column; inside
       * the dialog it should use the full body width instead. */
      '.dauw-modal-body .dauw-page{max-width:none}',
      /* hover tooltip (settings page) */
      '.dauw-tip-anchor{position:relative;width:100%}',
      '.dauw-tip{box-sizing:border-box;background:var(--dsw-alias-bg-overlay,#fff);border:0.5px solid var(--dsw-alias-border-l2,#ccc);border-radius:8px;box-shadow:0 8px 24px rgba(0,0,0,.18);padding:8px 10px;z-index:400;font-size:11px;line-height:1.6;color:var(--dsw-alias-label-primary,#111);pointer-events:none;white-space:normal;text-align:left;min-width:190px;max-width:300px;animation:dauw-fade-up 160ms ease-out}',
      '.dauw-tip-line{white-space:pre-wrap;word-break:break-word}',
      '.dauw-tip-line + .dauw-tip-line{color:var(--dsw-alias-label-secondary,#666)}',
      /* shared bits */
      '.dauw-row-icon{flex:none;display:inline-flex;opacity:.8;width:13px;height:13px}',
      '.dauw-dot{width:7px;height:7px;border-radius:50%;flex:none;display:inline-block}',
      '.dauw-dot-ok{background:#2ea05a}',
      '.dauw-dot-warn{background:#d39c1e}',
      '.dauw-dot-bad{background:var(--dsw-alias-state-error-primary,#d33)}',
      '.dauw-dot-wait{background:var(--dsw-alias-label-tertiary,#999)}',
      /* settings page */
      '.dauw-page{display:flex;flex-direction:column;gap:16px;font-family:var(--dsw-font,inherit);color:var(--dsw-alias-label-primary,#111);max-width:720px}',
      '.dauw-page-head{display:flex;align-items:center;gap:10px;flex-wrap:wrap}',
      '.dauw-page-title{font-size:15px;font-weight:600;margin:0}',
      '.dauw-page-sub{color:var(--dsw-alias-label-secondary,#666);font-size:12px;margin:0}',
      '.dauw-button{display:inline-flex;align-items:center;gap:6px;box-sizing:border-box;height:28px;padding:0 10px;border:none;border-radius:8px;background:var(--dsw-alias-bg-layer-2,#f0f0f0);color:var(--dsw-alias-label-primary,#111);font-size:12px;cursor:pointer;font-family:inherit}',
      '.dauw-button:hover{background:var(--dsw-alias-interactive-bg-hover,#e4e4e4)}',
      '.dauw-button:disabled{opacity:.6;cursor:default}',
      '.dauw-button.dauw-danger{color:var(--dsw-alias-state-error-primary,#d33)}',
      '.dauw-button.dauw-active{background:var(--dsw-alias-brand-primary,#247bbf);color:#fff}',
      '.dauw-group{margin:0;padding:0;border:0.5px solid var(--dsw-alias-border-l1,#e6e6e6);border-radius:12px;overflow:hidden}',
      '.dauw-group-title{display:flex;align-items:baseline;justify-content:space-between;padding:10px 14px 8px;color:var(--dsw-alias-label-secondary,#666);font-size:12px}',
      '.dauw-group-title b{color:var(--dsw-alias-label-primary,#111);font-size:13px;font-weight:600}',
      '.dauw-card{display:flex;flex-direction:column;gap:6px;padding:12px 14px;border-top:0.5px solid var(--dsw-alias-border-l1,#eee)}',
      '.dauw-card > *{flex:none}',
      '.dauw-card:first-of-type{border-top:none}',
      '.dauw-card-top{display:flex;align-items:center;gap:8px;min-width:0}',
      '.dauw-card-icon{flex:none;color:var(--dsw-alias-label-secondary,#666);display:inline-flex}',
      '.dauw-card-title{font-size:13px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-width:0}',
      '.dauw-card-tail{flex:none;color:var(--dsw-alias-label-tertiary,#999);font-size:11px;font-variant-numeric:tabular-nums}',
      '.dauw-card-value{margin-left:auto;flex:none;font-size:15px;font-weight:600;font-variant-numeric:tabular-nums;white-space:nowrap}',
      '.dauw-card-value.dauw-warn{color:#b98216}',
      '.dauw-card-value.dauw-bad{color:var(--dsw-alias-state-error-primary,#d33)}',
      '.dauw-card-sub{display:flex;flex-wrap:wrap;gap:4px 14px;color:var(--dsw-alias-label-secondary,#666);font-size:12px}',
      '.dauw-bar-row{display:flex;flex-direction:column;gap:5px;padding:2px 0;flex:none}',
      '.dauw-bar-label{display:flex;align-items:baseline;gap:8px;font-size:12px}',
      '.dauw-bar-title{flex:none;color:var(--dsw-alias-label-primary,#111);font-weight:500}',
      '.dauw-bar-count{flex:1 1 auto;min-width:0;color:var(--dsw-alias-label-tertiary,#999);font-variant-numeric:tabular-nums;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
      '.dauw-bar-pct{flex:none;font-weight:600;font-variant-numeric:tabular-nums;color:var(--dsw-alias-label-primary,#111)}',
      '.dauw-bar-pct.dauw-warn{color:#b98216}',
      '.dauw-bar-pct.dauw-bad{color:var(--dsw-alias-state-error-primary,#d33)}',
      '.dauw-bar-reset{flex:none;color:var(--dsw-alias-label-tertiary,#999);font-size:11px}',
      '.dauw-bar{height:12px;border-radius:999px;background:#f2f4f7;overflow:hidden;flex:none;box-shadow:inset 0 0 0 0.5px rgba(0,0,0,.05)}',
      '.dauw-bar-fill{height:100%;border-radius:999px;background:#5470c6;transition:width 320ms cubic-bezier(.4,0,.2,1)}',
      '.dauw-bar-fill.dauw-warn{background:#d39c1e}',
      '.dauw-bar-fill.dauw-bad{background:#d33}',
      '.dauw-switch{margin-left:auto;flex:none;width:32px;height:19px;border-radius:999px;border:none;padding:2px;cursor:pointer;background:var(--dsw-alias-bg-layer-3,#ccc);position:relative;transition:background 150ms ease}',
      '.dauw-switch[aria-checked="true"]{background:#2ea05a}',
      '.dauw-switch::after{content:"";position:absolute;top:2px;left:2px;width:15px;height:15px;border-radius:50%;background:#fff;transition:left 150ms ease;box-shadow:0 1px 2px rgba(0,0,0,.25)}',
      '.dauw-switch[aria-checked="true"]::after{left:15px}',
      '.dauw-card-top .dauw-switch{margin-left:8px}',
      '.dauw-card-value + .dauw-switch{margin-left:8px}',
      '.dauw-error{color:var(--dsw-alias-state-error-primary,#d33);font-size:12px;white-space:normal;word-break:break-all;margin:0}',
      '.dauw-notice{margin:0;color:var(--dsw-alias-label-secondary,#666);font-size:12px;line-height:1.6;white-space:normal}',
      '.dauw-avatar{flex:none;width:22px;height:22px;border-radius:50%;object-fit:cover}',
      '.dauw-link{color:var(--dsw-alias-brand-primary,#247bbf);text-decoration:none;font-size:12px}',
      '.dauw-link:hover{text-decoration:underline}',
      '.dauw-form{display:flex;flex-wrap:wrap;gap:8px;align-items:center}',
      '.dauw-input{box-sizing:border-box;height:28px;padding:0 8px;border:0.5px solid var(--dsw-alias-border-l2,#ccc);border-radius:8px;background:var(--dsw-alias-bg-layer-1,#fff);color:var(--dsw-alias-label-primary,#111);font-size:12px;font-family:inherit;min-width:0}',
      '.dauw-input.dauw-grow{flex:1 1 180px}',
      '.dauw-input.dauw-label{flex:0 1 130px}',
      '.dauw-select{height:28px;padding:0 6px;border:0.5px solid var(--dsw-alias-border-l2,#ccc);border-radius:8px;background:var(--dsw-alias-bg-layer-1,#fff);color:var(--dsw-alias-label-primary,#111);font-size:12px;font-family:inherit}',
      '.dauw-managed{display:flex;align-items:center;gap:8px;padding:8px 14px;border-top:0.5px solid var(--dsw-alias-border-l1,#eee);font-size:12px}',
      '.dauw-managed-name{flex:1 1 auto;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
      '.dauw-managed-tag{flex:none;color:var(--dsw-alias-label-tertiary,#999);font-size:11px}',
      '.dauw-spend{font-weight:600;color:var(--dsw-alias-label-primary,#111);font-variant-numeric:tabular-nums}',
      '.dauw-charts{display:flex;flex-direction:row;gap:14px;width:100%;padding:2px 0 4px}',
      '.dauw-chart-pane{flex:1 1 50%;display:flex;flex-direction:column;gap:2px;min-width:0}',
      '.dauw-spark-label{flex:none;color:var(--dsw-alias-label-tertiary,#999);font-size:11px}',
      '.dauw-chart{width:100%;height:100px}',
      '.dauw-calendar{width:100%;height:100px}',
      '.dauw-spark-empty{width:100%;padding:2px 0 4px;color:var(--dsw-alias-label-tertiary,#999);font-size:11px}',
      '.dauw-badge-toggle{flex:none;display:inline-flex;align-items:center;justify-content:center;width:24px;height:24px;padding:0;border:none;border-radius:6px;background:transparent;color:var(--dsw-alias-label-tertiary,#999);cursor:pointer;transition:background 120ms ease,color 120ms ease}',
      '.dauw-badge-toggle:hover{background:var(--dsw-alias-bg-layer-2,#f0f0f0);color:var(--dsw-alias-label-primary,#111)}',
      '.dauw-badge-toggle.dauw-active{color:var(--dsw-alias-label-primary,#111)}',
    ].join('\n')

    const styleTag = 'dsh-api-usage/usage.css'
    if (typeof document !== 'undefined' && document.querySelector(`style[data-plugin-css="${styleTag}"]`) === null) {
      const tag = document.createElement('style')
      tag.dataset.plugin = 'dsh-api-usage'
      tag.dataset.pluginCss = styleTag
      tag.textContent = css
      document.head.appendChild(tag)
    }

    /* ── formatting helpers ────────────────────────────────────────────── */

    function toNumberOrNull(value) {
      const n = typeof value === 'number' ? value : typeof value === 'string' && value.trim() !== '' ? Number(value) : NaN
      return Number.isFinite(n) ? n : null
    }

    function formatCredits(value) {
      const n = toNumberOrNull(value)
      if (n === null) return String(value)
      return (Math.round(n * 10) / 10).toLocaleString('en-US')
    }

    function formatTokens(value) {
      const n = toNumberOrNull(value)
      if (n === null) return String(value)
      return n.toLocaleString('en-US')
    }

    function formatCountdown(targetMs, nowMs) {
      const remaining = targetMs - nowMs
      if (!Number.isFinite(remaining) || remaining <= 0) return null
      const minutes = Math.floor(remaining / 60000)
      if (minutes < 1) return '<1m'
      if (minutes < 60) return `${minutes}m`
      const hours = Math.floor(minutes / 60)
      if (hours < 48) return `${hours}h ${minutes % 60}m`
      return `${Math.floor(hours / 24)}d ${hours % 24}h`
    }

    function formatTime(iso) {
      try {
        const d = new Date(iso)
        if (Number.isNaN(d.getTime())) return ''
        const pad = (n) => String(n).padStart(2, '0')
        return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
      } catch {
        return ''
      }
    }

    function pickBalanceRow(balanceInfos) {
      if (!Array.isArray(balanceInfos) || balanceInfos.length === 0) return null
      const positive = (row) => (toNumberOrNull(row && row.total_balance) ?? -1) > 0
      const cny = balanceInfos.filter((row) => row && row.currency === 'CNY')
      return cny.find(positive) ?? balanceInfos.find(positive) ?? cny[0] ?? balanceInfos[0] ?? null
    }

    function levelToLabel(level) {
      if (typeof level !== 'string' || level === '') return ''
      return level.charAt(0).toUpperCase() + level.slice(1)
    }

    function moneyOf(total, row) {
      const currency = row !== null && row.currency === 'USD' ? '$' : '¥'
      const n = toNumberOrNull(total)
      if (n === null) return '—'
      return `${currency}${n % 1 === 0 ? n.toFixed(0) : n.toFixed(2)}`
    }

    /* ── shared summary store (single poller) ──────────────────────────── */

    const store = {
      state: { phase: 'loading', summary: null, message: null },
      consumers: new Set(),
      timer: 0,
      loading: false,
    }

    function emit() {
      for (const consumer of store.consumers) consumer()
    }

    async function loadSummary() {
      if (store.loading) return
      store.loading = true
      let next
      try {
        const response = await fetch('/api-usage/summary', { method: 'GET', cache: 'no-store' })
        const json = await response.json()
        if (json && json.ok) next = { phase: 'ready', summary: json, message: null }
        else next = { phase: 'error', summary: null, message: (json && (json.message || json.error)) || 'unknown error' }
      } catch (err) {
        next = { phase: 'error', summary: null, message: (err && err.message) || String(err) }
      }
      store.state = next
      store.loading = false
      emit()
      const seconds = Math.max(15, toNumberOrNull(next.summary && next.summary.pollSeconds) ?? 60)
      if (store.timer !== 0) clearInterval(store.timer)
      if (store.consumers.size > 0) store.timer = setInterval(loadSummary, seconds * 1000)
    }

    function consumeSummary() {
      const [, force] = React.useReducer((x) => x + 1, 0)
      React.useEffect(() => {
        store.consumers.add(force)
        const idle = store.consumers.size === 1
        if (idle && store.timer === 0) loadSummary()
        return () => {
          store.consumers.delete(force)
          if (store.consumers.size === 0 && store.timer !== 0) {
            clearInterval(store.timer)
            store.timer = 0
          }
        }
      }, [force])
      return store.state
    }

    function useNow(intervalMs) {
      const [now, setNow] = React.useState(() => Date.now())
      React.useEffect(() => {
        const timer = setInterval(() => setNow(Date.now()), intervalMs)
        return () => clearInterval(timer)
      }, [intervalMs])
      return now
    }

    async function postJson(path, payload) {
      try {
        await fetch(path, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(payload),
        })
      } catch {
        /* the plugin restarts on a config write; the reload below recovers */
      }
      setTimeout(loadSummary, 700)
    }

    /* ── badge selection (local first, synced in the background) ───────── */

    /**
     * The badge subject is a pure UI preference, so it is written to
     * localStorage and applied immediately — persisting it through the Host
     * config editor restarts the plugin, which made switching feel slow. The
     * Host copy is still written in the background so the choice can follow
     * the user to another browser.
     */
    const SELECTION_KEY = 'api-usage:selected-source'
    const selectionListeners = new Set()

    function readLocalSelection() {
      try {
        const raw = localStorage.getItem(SELECTION_KEY)
        return typeof raw === 'string' ? raw : ''
      } catch {
        return ''
      }
    }

    function writeLocalSelection(id) {
      try {
        localStorage.setItem(SELECTION_KEY, id)
      } catch {
        /* storage disabled — the in-memory listeners still update the UI */
      }
      for (const listener of selectionListeners) listener()
      postJson('/api-usage/selection', { id })
    }

    function useSelection() {
      const [current, setCurrent] = React.useState(readLocalSelection)
      React.useEffect(() => {
        const listener = () => setCurrent(readLocalSelection())
        selectionListeners.add(listener)
        return () => selectionListeners.delete(listener)
      }, [])
      return current
    }

    function visibleSources(summary, id) {
      const hidden = Array.isArray(summary.hidden) ? summary.hidden : []
      return !hidden.includes(id)
    }

    /* ── source rows ───────────────────────────────────────────────────── */

    /** Whether a source is included in the badge aggregation (switch state). */
    function sourceVisible(summary, id) {
      return visibleSources(summary, id)
    }

    /**
     * Every source as a display row. DeepSeek spend is folded into the first
     * DeepSeek balance row (`balance · ≈today`) instead of its own row, and
     * `detail` carries the hover-card lines.
     */
    function buildSourceRows(summary, t) {
      const rows = []
      const lowBalance = toNumberOrNull(summary.lowBalance) ?? 20
      /* Each source meters its own day: the account route and the API-key
       * routes are separate cost centres. A zero still shows as ≈¥0.00 so the
       * absence of use is visible rather than silently missing. */
      const spendOf = (own) => {
        const cost = toNumberOrNull(own && own.costCny)
        const calls = toNumberOrNull(own && own.calls) ?? 0
        const amount = cost !== null && cost > 0 ? cost : 0
        return {
          text: `≈¥${amount.toFixed(2)}`,
          detail: [
            `${t('spend.title')} ≈¥${amount.toFixed(2)} · ${t('spend.calls', { calls: formatTokens(calls) })}`,
            t('spend.hint'),
          ],
        }
      }

      const account = summary.account
      if (account && account.signedIn) {
        const wallets = account.balance && Array.isArray(account.balance.value) ? account.balance.value : []
        const wallet = wallets.find((w) => w.currency === 'CNY') ?? wallets[0] ?? null
        const total = toNumberOrNull(wallet && wallet.balance)
        const name = (account.profile && (account.profile.name || account.profile.contact)) || ''
        const spend = spendOf(account.spend)
        rows.push({
          id: 'account',
          kind: 'account',
          icon: 'account',
          name: name !== '' ? name : t('account.title'),
          value: wallet !== null ? `${moneyOf(total, wallet)} · ${spend.text}` : spend.text,
          tone: total !== null && total <= lowBalance ? 'dauw-warn' : '',
          detail: [
            `${t('account.title')} · ${name !== '' ? name : 'DeepSeek'}`,
            wallet !== null ? `${wallet.currency} ${wallet.balance}` : '—',
            ...(Array.isArray(account.balance && account.balance.bonusWallets)
              ? account.balance.bonusWallets.map((b) => `${t('account.bonus')}: ${b.currency} ${b.balance}`)
              : []),
            ...spend.detail,
          ],
        })
      }

      for (const entry of summary.deepseek || []) {
        const balanceRow = entry.ok ? pickBalanceRow(entry.data && entry.data.balance_infos) : null
        const total = toNumberOrNull(balanceRow && balanceRow.total_balance)
        const unavailable = entry.ok && entry.data && entry.data.is_available === false
        const tone = !entry.ok ? 'dauw-bad' : unavailable ? 'dauw-warn' : total !== null && total <= lowBalance ? 'dauw-warn' : ''
        const balanceText = balanceRow !== null ? moneyOf(total, balanceRow) : entry.ok ? '—' : '!'
        const spend = spendOf(entry.spend)
        rows.push({
          id: entry.id,
          kind: 'deepseek',
          icon: 'key',
          name: entry.label,
          value: `${balanceText} · ${spend.text}`,
          tone,
          detail: [
            `${entry.label}${entry.tail ? ` ···${entry.tail}` : ''}${entry.keyName ? ` · ${entry.keyName}` : ''}`,
            balanceRow !== null
              ? `${balanceRow.currency} ${balanceRow.total_balance} · ${t('key.granted', { value: balanceRow.granted_balance })} · ${t('key.topped', { value: balanceRow.topped_up_balance })}`
              : (entry.ok ? '—' : String(entry.error ?? '')),
            ...spend.detail,
          ],
        })
      }

      /* Fallback only when no per-source figure exists at all. */
      if (rows.length === 0) {
        const spendToday = summary.spend && summary.spend.today ? summary.spend.today : null
        const cost = toNumberOrNull(spendToday && spendToday.costCny)
        if (cost !== null && cost > 0) {
          rows.push({
            id: 'spend:deepseek',
            kind: 'spend',
            icon: 'chart',
            name: t('spend.footer'),
            value: `≈¥${cost.toFixed(2)}`,
            tone: '',
            detail: [
              `${t('spend.title')} ≈¥${cost.toFixed(2)} · ${t('spend.calls', { calls: formatTokens(spendToday.calls) })}`,
              t('spend.hint'),
            ],
          })
        }
      }

      for (const entry of summary.glm || []) {
        const session = entry.ok && entry.data && entry.data.windows ? entry.data.windows.session : null
        const pct = toNumberOrNull(session && session.percentage)
        const used = toNumberOrNull(session && session.used)
        const total = toNumberOrNull(session && session.total)
        const level = entry.ok && entry.data && typeof entry.data.level === 'string' ? entry.data.level : ''
        const levelLabel = level !== '' ? levelToLabel(level) : ''
        const credits = used !== null && total !== null && total > 0
          ? `${formatCredits(used)}/${formatCredits(total)}`
          : null
        const countdown = session && session.nextResetTime ? formatCountdown(session.nextResetTime, Date.now()) : null
        const today = entry.ok && entry.data && entry.data.today ? entry.data.today : null
        rows.push({
          id: entry.id,
          kind: 'glm',
          icon: 'key',
          name: entry.label,
          value: credits !== null ? credits : pct !== null ? `${Math.round(pct)}%` : entry.ok ? '—' : '!',
          tone: !entry.ok ? 'dauw-bad' : pct !== null && pct >= 95 ? 'dauw-bad' : pct !== null && pct >= 80 ? 'dauw-warn' : '',
          detail: [
            `${entry.label}${levelLabel !== '' ? ` · GLM Coding ${levelLabel}` : ''}${entry.tail ? ` ···${entry.tail}` : ''}`,
            pct !== null ? `${t('glm.window5h')} ${Math.round(pct)}%${credits !== null ? ` · ${credits}` : ''}` : null,
            countdown !== null ? t('glm.resetIn', { time: countdown }) : null,
            today !== null && today.credits !== null ? `${t('glm.today')} ${t('glm.todayCredits', { credits: formatCredits(today.credits) })}` : null,
            today !== null && today.tokens !== null ? t('glm.todayTokens', { tokens: formatTokens(today.tokens) }) : null,
            entry.ok === false && entry.error !== null ? String(entry.error) : null,
          ].filter((line) => line !== null),
        })
      }

      return rows
    }

    /* ── icons ─────────────────────────────────────────────────────────── */

    /** Per-source day summary for the settings cards. */
    function spendSummaryOf(own) {
      const cost = toNumberOrNull(own && own.costCny)
      const calls = toNumberOrNull(own && own.calls) ?? 0
      const amount = cost !== null && cost > 0 ? cost : 0
      return { text: `≈¥${amount.toFixed(2)}`, calls, amount }
    }

    /**
     * Two full-width ECharts per source card: a 7-day bar trend on top and a
     * 90-day GitHub-style calendar heatmap below, both scoped to this source's
     * provider or the combined total.
     */
    function MiniBars(props) {
      const t = props.t
      const days = Array.isArray(props.days) ? props.days : []
      const calendarDays = Array.isArray(props.calendar) ? props.calendar : []
      const barRef = React.useRef(null)
      const calRef = React.useRef(null)

      const scopedCost = (day) => {
        const bucket = props.providerId !== undefined && day.byProvider ? day.byProvider[props.providerId] : day
        return toNumberOrNull(bucket && bucket.costCny) ?? 0
      }
      const values = days.map(scopedCost)
      const max = values.reduce((acc, value) => Math.max(acc, value), 0)
      /* Charts always render, even for a source with no spend yet: the empty
       * track and blank calendar communicate "nothing recorded" better than a
       * missing chart. A zero max would divide by zero, so clamp it. */
      const yMax = max > 0 ? max : 1

      const calValues = calendarDays.map((day) => [day.date, scopedCost(day)])
      const calMax = calValues.reduce((acc, [, value]) => Math.max(acc, value), 0)
      const calendarRange = calendarDays.length > 0
        ? [calendarDays[0].date, calendarDays[calendarDays.length - 1].date]
        : null

      const signature = `${values.map((value) => value.toFixed(4)).join(',')}|${calValues.map((row) => row.join(':')).join(',')}`
      const dates = days.map((day) => day.date.slice(5))

      React.useEffect(() => {
        const styles = getComputedStyle(document.documentElement)
        const font = styles.getPropertyValue('--dsw-font').trim() || 'sans-serif'
        /* ECharts' own palette, not the DSH brand token: `--dsw-alias-brand-primary`
         * is the near-black action color, which reads as a dark bar here. */
        const accent = '#5470c6'
        const empty = '#ebedf0'
        const mutedText = '#9aa3ad'
        const charts = []

        const barEl = barRef.current
        if (barEl !== null && days.length > 0) {
          const chart = echarts.init(barEl)
          chart.setOption({
            animation: false,
            textStyle: { fontFamily: font },
            grid: { left: 4, right: 4, top: 8, bottom: 22 },
            xAxis: { type: 'category', data: dates, axisLabel: { fontSize: 10, interval: 0 } },
            yAxis: { type: 'value', max: yMax, show: false },
            tooltip: { trigger: 'axis' },
            color: [accent],
            series: [{
              type: 'bar',
              data: values,
              barMaxWidth: 18,
              /* A faint track behind every bar keeps the chart from looking
               * empty on days without spend. */
              showBackground: true,
              backgroundStyle: { color: '#f2f4f7', borderRadius: [3, 3, 0, 0] },
              itemStyle: { borderRadius: [3, 3, 0, 0] },
            }],
          })
          charts.push(chart)
        }

        const calEl = calRef.current
        if (calEl !== null && calendarRange !== null) {
          const chart = echarts.init(calEl)
          chart.setOption({
            animation: false,
            textStyle: { fontFamily: font },
            tooltip: {
              formatter: (params) => {
                const value = Array.isArray(params.value) ? params.value : []
                const date = value[0]
                const cost = Number(value[1] ?? 0)
                return `${date} · ${t('spend.cost', { amount: cost.toFixed(2) })}`
              },
            },
            visualMap: {
              min: 0,
              max: calMax > 0 ? calMax : 1,
              show: false,
              inRange: { color: [empty, accent] },
            },
            calendar: {
              range: calendarRange,
              left: 22,
              right: 2,
              top: 20,
              bottom: 2,
              /* Width stretches to the pane; height stays 14 so the grid keeps
               * a calendar shape instead of shrinking into a centred block. */
              cellSize: ['auto', 14],
              orient: 'horizontal',
              dayLabel: {
                firstDay: 1,
                nameMap: ['日', '一', '二', '三', '四', '五', '六'],
                fontSize: 8,
                color: mutedText,
                margin: 4,
              },
              monthLabel: { nameMap: 'ZH', fontSize: 8, color: mutedText, margin: 3 },
              yearLabel: { show: false },
              itemStyle: { borderWidth: 1.5, borderColor: 'transparent' },
              splitLine: { show: false },
            },
            series: [{
              type: 'heatmap',
              coordinateSystem: 'calendar',
              data: calValues,
              itemStyle: { borderRadius: 2 },
              emphasis: { itemStyle: { borderColor: accent, borderWidth: 1 } },
            }],
          })
          charts.push(chart)
        }

        const resize = () => {
          for (const chart of charts) chart.resize()
        }
        window.addEventListener('resize', resize)
        const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(resize) : null
        if (observer !== null) {
          if (barEl !== null) observer.observe(barEl)
          if (calEl !== null) observer.observe(calEl)
        }
        return () => {
          window.removeEventListener('resize', resize)
          if (observer !== null) observer.disconnect()
          for (const chart of charts) chart.dispose()
        }
      }, [signature, max, calMax])

      if (days.length === 0 && calendarDays.length === 0) return null

      return h('div', { className: 'dauw-charts' },
        h('div', { className: 'dauw-chart-pane' },
          h('div', { ref: barRef, className: 'dauw-chart' })),
        h('div', { className: 'dauw-chart-pane' },
          h('div', { ref: calRef, className: 'dauw-calendar' })))
    }

    const CHART_ICON = h('svg', {
      viewBox: '0 0 16 16', width: 13, height: 13, 'aria-hidden': 'true',
      fill: 'none', stroke: 'currentColor', strokeWidth: 1.5, strokeLinecap: 'round',
    },
      h('path', { d: 'M2 13h12' }),
      h('path', { d: 'M4.5 10.5v-3' }),
      h('path', { d: 'M8 10.5V4.5' }),
      h('path', { d: 'M11.5 10.5v-5' }))

    const ROW_ICONS = {
      account: h('svg', {
        viewBox: '0 0 16 16', width: 12, height: 12, 'aria-hidden': 'true',
        fill: 'none', stroke: 'currentColor', strokeWidth: 1.5, strokeLinecap: 'round',
      },
        h('circle', { cx: 8, cy: 5.4, r: 2.4 }),
        h('path', { d: 'M3.6 13c.7-2.1 2.4-3.2 4.4-3.2s3.7 1.1 4.4 3.2' })),
      key: h('svg', {
        viewBox: '0 0 16 16', width: 12, height: 12, 'aria-hidden': 'true',
        fill: 'none', stroke: 'currentColor', strokeWidth: 1.5, strokeLinecap: 'round',
      },
        h('circle', { cx: 5.2, cy: 10.8, r: 2.2 }),
        h('path', { d: 'M6.9 9.1 12.2 3.8' })),
      chart: h('svg', {
        viewBox: '0 0 16 16', width: 12, height: 12, 'aria-hidden': 'true',
        fill: 'none', stroke: 'currentColor', strokeWidth: 1.5, strokeLinecap: 'round',
      },
        h('path', { d: 'M2.5 13h11' }),
        h('path', { d: 'M5 10.5v-2.5' }),
        h('path', { d: 'M8 10.5V5.5' }),
        h('path', { d: 'M11 10.5v-4' })),
    }

    const KEY_ICON = h('svg', {
      viewBox: '0 0 16 16', width: 15, height: 15, 'aria-hidden': 'true',
      fill: 'none', stroke: 'currentColor', strokeWidth: 1.3, strokeLinecap: 'round', strokeLinejoin: 'round',
    },
      h('circle', { cx: 5, cy: 10.8, r: 2.4 }),
      h('path', { d: 'M6.8 9 12.4 3.4' }),
      h('path', { d: 'M10.3 5.5l1.8 1.8' }),
      h('path', { d: 'M12.4 3.4l1.4 1.4' }))

    const ACCOUNT_ICON = h('svg', {
      viewBox: '0 0 16 16', width: 15, height: 15, 'aria-hidden': 'true',
      fill: 'none', stroke: 'currentColor', strokeWidth: 1.3, strokeLinecap: 'round',
    },
      h('circle', { cx: 8, cy: 5.4, r: 2.6 }),
      h('path', { d: 'M3.2 13.2c.8-2.4 2.6-3.6 4.8-3.6s4 1.2 4.8 3.6' }))

    const REFRESH_ICON = h('svg', {
      viewBox: '0 0 16 16', width: 13, height: 13, 'aria-hidden': 'true',
      fill: 'none', stroke: 'currentColor', strokeWidth: 1.5, strokeLinecap: 'round', strokeLinejoin: 'round',
    },
      h('path', { d: 'M13 8a5 5 0 1 1-1.5-3.5' }),
      h('path', { d: 'M13 2.8v2.4h-2.4' }))

    const PAGE_ICON = h('svg', {
      viewBox: '0 0 16 16', width: 16, height: 16, 'aria-hidden': 'true',
      fill: 'none', stroke: 'currentColor', strokeWidth: 1.4, strokeLinecap: 'round',
    },
      h('path', { d: 'M2 13h12' }),
      h('path', { d: 'M4.5 10.5v-3' }),
      h('path', { d: 'M8 10.5V4.5' }),
      h('path', { d: 'M11.5 10.5v-5' }))

    /* ── hover tooltip (settings page) ─────────────────────────────────── */

    /** Animated, delayed tooltip positioned `fixed` so nothing clips it. */
    function HoverTip(props) {
      const [anchor, setAnchor] = React.useState(null)
      const anchorRef = React.useRef(null)
      const openTimer = React.useRef(0)
      const closeTimer = React.useRef(0)
      React.useEffect(() => () => {
        clearTimeout(openTimer.current)
        clearTimeout(closeTimer.current)
      }, [])
      const enter = () => {
        clearTimeout(closeTimer.current)
        openTimer.current = setTimeout(() => {
          const el = anchorRef.current
          if (el === null) return
          const rect = el.getBoundingClientRect()
          setAnchor({ left: Math.round(rect.left), bottom: Math.round(window.innerHeight - rect.top + 6) })
        }, 300)
      }
      const leave = () => {
        clearTimeout(openTimer.current)
        closeTimer.current = setTimeout(() => setAnchor(null), 160)
      }
      const lines = Array.isArray(props.lines) ? props.lines.filter((line) => typeof line === 'string' && line !== '') : []
      return h('div', { ref: anchorRef, className: 'dauw-tip-anchor', onMouseEnter: enter, onMouseLeave: leave },
        props.children,
        anchor !== null && lines.length > 0
          ? h('div', {
              className: 'dauw-tip',
              role: 'tooltip',
              style: { position: 'fixed', left: `${anchor.left}px`, bottom: `${anchor.bottom}px` },
            }, lines.map((line, index) => h('div', { key: index, className: 'dauw-tip-line' }, line)))
          : null)
    }

    /* ── composer badge ────────────────────────────────────────────────── */

    function badgeSources(summary) {
      const list = []
      if (summary.account && summary.account.signedIn) {
        list.push({
          id: 'account',
          kind: 'account',
          name: (summary.account.profile && (summary.account.profile.name || summary.account.profile.contact)) || 'DeepSeek',
          spend: summary.account.spend ?? null,
        })
      }
      for (const entry of summary.deepseek || []) list.push({ id: entry.id, kind: 'deepseek', name: entry.label, entry })
      for (const entry of summary.glm || []) list.push({ id: entry.id, kind: 'glm', name: entry.label, entry })
      return list
    }

    /** Badge subject: the local choice, the Host choice, else the account. */
    function resolveBadgeSource(summary, selection) {
      const sources = badgeSources(summary)
      const chosen = typeof selection === 'string' && selection !== ''
        ? selection
        : typeof summary.selectedSource === 'string' ? summary.selectedSource : ''
      if (chosen !== '') {
        const hit = sources.find((source) => source.id === chosen)
        if (hit !== undefined) return hit
      }
      return sources.find((source) => source.kind === 'account') ?? null
    }

    /** `≈today/balance` for DeepSeek sources; `used/total` for GLM. */
    function badgeText(summary, source, t) {
      if (source === null) return t('badge.none')
      if (source.kind === 'glm') {
        const session = source.entry.ok && source.entry.data && source.entry.data.windows ? source.entry.data.windows.session : null
        const used = toNumberOrNull(session && session.used)
        const total = toNumberOrNull(session && session.total)
        const pct = toNumberOrNull(session && session.percentage)
        if (used !== null && total !== null && total > 0) return `${formatCredits(used)}/${formatCredits(total)}`
        return pct !== null ? `${Math.round(pct)}%` : '—'
      }
      /* Each source carries its own metered spend: the account route and the
       * API-key routes are different cost centres. A zero shows as ≈¥0.00 so
       * the absence of use is visible rather than silently missing. */
      const own = source.kind === 'account' ? source.spend : source.entry.spend
      const today = toNumberOrNull(own && own.costCny)
      const spendAmount = today !== null && today > 0 ? today : 0
      const spend = `≈¥${spendAmount.toFixed(2)}`
      let balance = null
      if (source.kind === 'account') {
        const wallets = summary.account.balance && Array.isArray(summary.account.balance.value) ? summary.account.balance.value : []
        const wallet = wallets.find((w) => w.currency === 'CNY') ?? wallets[0] ?? null
        balance = toNumberOrNull(wallet && wallet.balance)
      } else if (source.entry.ok) {
        const row = pickBalanceRow(source.entry.data && source.entry.data.balance_infos)
        balance = toNumberOrNull(row && row.total_balance)
      }
      const money = balance === null
        ? '—'
        : `¥${balance % 1 === 0 ? balance.toFixed(0) : balance.toFixed(2)}`
      return `${spend}/${money}`
    }

    /**
     * The settings shell keeps its dialog state internal and exposes no
     * navigation API, and binding host DOM is explicitly discouraged. The
     * manager therefore opens in a plugin-owned overlay dialog instead.
     */
    let managerOpen = false
    const managerListeners = new Set()

    function setManagerOpen(open) {
      managerOpen = open
      for (const listener of managerListeners) listener()
    }

    function useManagerOpen() {
      const [open, setOpen] = React.useState(managerOpen)
      React.useEffect(() => {
        const listener = () => setOpen(managerOpen)
        managerListeners.add(listener)
        return () => managerListeners.delete(listener)
      }, [])
      return open
    }

    /** Plugin-owned management dialog mounted through `shell.overlay`. */
    function ManagerDialog(props) {
      const t = props.t
      const open = useManagerOpen()
      if (!open) return null
      return h('div', {
        className: 'dauw-modal-mask',
        role: 'presentation',
        onClick: () => setManagerOpen(false),
      },
        h('div', {
          className: 'dauw-modal',
          role: 'dialog',
          'aria-modal': 'true',
          'aria-label': t('settings.title'),
          onClick: (event) => event.stopPropagation(),
        },
          h('div', { className: 'dauw-modal-head' },
            h('h2', { className: 'dauw-modal-title' }, t('settings.title')),
            h('button', {
              type: 'button',
              className: 'dauw-modal-close',
              'aria-label': t('manager.close'),
              onClick: () => setManagerOpen(false),
            }, '✕')),
          h('div', { className: 'dauw-modal-body' }, h(SettingsPage, { t }))))
    }

    /**
     * Composer tool-row badge: one selected source, with an interactive panel
     * on hover where any row can become the badge subject (persisted in
     * plugin config so the choice follows the user across browsers).
     */
    function Badge(props) {
      const t = props.t
      const state = consumeSummary()
      const [panel, setPanel] = React.useState(null)
      const anchorRef = React.useRef(null)
      const openTimer = React.useRef(0)
      const closeTimer = React.useRef(0)

      React.useEffect(() => () => {
        clearTimeout(openTimer.current)
        clearTimeout(closeTimer.current)
      }, [])

      const openPanel = () => {
        clearTimeout(closeTimer.current)
        clearTimeout(openTimer.current)
        openTimer.current = setTimeout(() => {
          const el = anchorRef.current
          if (el === null) return
          const rect = el.getBoundingClientRect()
          setPanel({ left: Math.round(rect.left), bottom: Math.round(window.innerHeight - rect.top + 6) })
        }, 300)
      }
      const scheduleClose = () => {
        clearTimeout(openTimer.current)
        clearTimeout(closeTimer.current)
        closeTimer.current = setTimeout(() => setPanel(null), 200)
      }
      const keepOpen = () => clearTimeout(closeTimer.current)

      const summary = state.phase === 'ready' ? state.summary : null
      const selection = useSelection()
      const source = summary !== null ? resolveBadgeSource(summary, selection) : null
      const text = summary !== null ? badgeText(summary, source, t) : (state.phase === 'error' ? '!' : t('state.loading'))
      const isError = state.phase === 'error'

      let panelNode = null
      if (panel !== null && summary !== null) {
        panelNode = h('div', {
          className: 'dauw-panel',
          role: 'menu',
          style: { position: 'fixed', left: `${panel.left}px`, bottom: `${panel.bottom}px` },
          onMouseEnter: keepOpen,
          onMouseLeave: scheduleClose,
        },
          h('div', { className: 'dauw-panel-head' }, t('badge.title')),
          badgeSources(summary).length === 0
            ? h('div', { className: 'dauw-panel-empty' }, t('sources.empty'))
            : badgeSources(summary).map((candidate) => {
                const active = source !== null && candidate.id === source.id
                return h('button', {
                  key: candidate.id,
                  type: 'button',
                  role: 'menuitemradio',
                  'aria-checked': active ? 'true' : 'false',
                  className: 'dauw-panel-row' + (active ? ' dauw-panel-row-active' : ''),
                  onClick: () => {
                    setPanel(null)
                    writeLocalSelection(candidate.id)
                  },
                },
                  h('span', { className: 'dauw-panel-radio' }, active ? h('span', { className: 'dauw-panel-radio-dot' }) : null),
                  h('span', { className: 'dauw-panel-icon' }, ROW_ICONS[candidate.kind === 'account' ? 'account' : 'key'] ?? CHART_ICON),
                  h('span', { className: 'dauw-panel-name' }, candidate.name),
                  h('span', { className: 'dauw-panel-value' }, badgeText(summary, candidate, t)))
              }),
          h('div', { className: 'dauw-panel-foot' },
            h('span', { className: 'dauw-panel-hint-text' }, t('badge.hint')),
            h('button', {
              type: 'button',
              className: 'dauw-panel-action',
              onClick: () => {
                setPanel(null)
                setManagerOpen(true)
              },
            }, t('badge.openSettings'))))
      }

      return h('div', {
        ref: anchorRef,
        className: 'dauw-badge-wrap',
        onMouseEnter: summary !== null ? openPanel : undefined,
        onMouseLeave: summary !== null ? scheduleClose : undefined,
      },
        h('button', {
          type: 'button',
          className: 'dauw-badge' + (isError ? ' dauw-badge-bad' : ''),
          'aria-label': t('badge.title'),
          'aria-haspopup': 'true',
          'aria-expanded': panel !== null ? 'true' : 'false',
          onClick: () => { loadSummary() },
        },
          h('span', { className: 'dauw-row-icon' }, CHART_ICON),
          h('span', { className: 'dauw-badge-text' }, text)),
        panelNode !== null && createPortal !== null ? createPortal(panelNode, document.body) : panelNode)
    }

    /* ── settings page ─────────────────────────────────────────────────── */

    function Bar(props) {
      const pct = Math.max(0, Math.min(100, Math.round(toNumberOrNull(props.pct) ?? 0)))
      const tone = pct >= 95 ? ' dauw-bad' : pct >= 80 ? ' dauw-warn' : ''
      return h('div', { className: 'dauw-bar' },
        h('div', { className: 'dauw-bar-fill' + tone, style: { width: `${pct}%` } }))
    }

    function WindowRow(props) {
      const t = props.t
      const now = useNow(30000)
      const window = props.window
      if (window === null || window === undefined) return null
      const pct = toNumberOrNull(window.percentage)
      const countdown = window.nextResetTime !== null && window.nextResetTime !== undefined
        ? formatCountdown(window.nextResetTime, now)
        : null
      const used = toNumberOrNull(window.used)
      const total = toNumberOrNull(window.total)
      const hasCounts = used !== null && total !== null && total > 0
      const tone = pct !== null && pct >= 95 ? ' dauw-bad' : pct !== null && pct >= 80 ? ' dauw-warn' : ''
      return h('div', { className: 'dauw-bar-row' },
        h('div', { className: 'dauw-bar-label' },
          h('span', { className: 'dauw-bar-title' }, props.label),
          hasCounts
            ? h('span', { className: 'dauw-bar-count' }, t(props.unit, { used: formatCredits(used), total: formatCredits(total) }))
            : null,
          pct !== null ? h('span', { className: 'dauw-bar-pct' + tone }, `${Math.round(pct)}%`) : null,
          countdown !== null ? h('span', { className: 'dauw-bar-reset' }, t('glm.resetIn', { time: countdown })) : null),
        h(Bar, { pct: pct ?? 0 }))
    }

    function Switch(props) {
      return h('button', {
        type: 'button',
        role: 'switch',
        className: 'dauw-switch',
        'aria-checked': props.checked ? 'true' : 'false',
        'aria-label': props.label,
        onClick: () => props.onToggle(!props.checked),
      })
    }

    /** The effective badge subject (empty when nothing is selectable). */
    function effectiveSelection(summary, selection) {
      const chosen = typeof selection === 'string' && selection !== ''
        ? selection
        : typeof summary.selectedSource === 'string' ? summary.selectedSource : ''
      if (chosen !== '') return chosen
      return summary.account && summary.account.signedIn ? 'account' : ''
    }

    /** Star glyph: hollow when unselected, filled when this source is the badge subject. */
    function BadgeIcon(props) {
      return h('svg', {
        viewBox: '0 0 16 16', width: 15, height: 15, 'aria-hidden': 'true',
        fill: props.active ? 'currentColor' : 'none',
        stroke: 'currentColor',
        strokeWidth: 1.3,
        strokeLinejoin: 'round',
      }, h('path', { d: 'M8 1.6l1.9 3.9 4.3.6-3.1 3 .7 4.3L8 11.4l-3.8 1.9.7-4.3-3.1-3 4.3-.6z' }))
    }

    /** Icon-only "show this source on the badge" toggle, beside the switch. */
    function BadgeButton(props) {
      return h('button', {
        type: 'button',
        className: 'dauw-badge-toggle' + (props.active ? ' dauw-active' : ''),
        'aria-pressed': props.active ? 'true' : 'false',
        'aria-label': props.label,
        onClick: props.onClick,
      }, h(BadgeIcon, { active: props.active }))
    }

    /**
     * Shared card shell so every source card has identical chrome: header
     * (icon, title, masked tail, right-aligned figure, badge toggle, switch)
     * plus a free body for source-specific content.
     */
    function CardShell(props) {
      const t = props.t
      const hasValue = props.value !== null && props.value !== undefined
      return h('div', { className: 'dauw-card' },
        h('div', { className: 'dauw-card-top' },
          h('span', { className: 'dauw-card-icon' }, props.icon),
          props.avatar ? h('img', { className: 'dauw-avatar', src: props.avatar, alt: '' }) : null,
          h('span', { className: 'dauw-card-title' }, props.title),
          props.tail ? h('span', { className: 'dauw-card-tail' }, props.tail) : null,
          hasValue
            ? h('span', { className: 'dauw-card-value' + (props.valueTone ? ` ${props.valueTone}` : '') }, props.value)
            : null,
          h(BadgeButton, {
            active: props.badgeActive,
            label: t('badge.select'),
            onClick: props.onPickBadge,
          }),
          h(Switch, {
            checked: props.checked,
            label: t('toggle.label'),
            onToggle: props.onToggle,
          })),
        props.children,
        props.footer)
    }

    /** One source's day line: `≈today · N calls · status` plus wallet facts. */
    function SpendLine(props) {
      const t = props.t
      return h('div', { className: 'dauw-card-sub' },
        h('span', { className: 'dauw-spend' }, props.spend.text),
        h('span', null, t('spend.calls', { calls: formatTokens(props.spend.calls) })),
        props.status ? h('span', null, props.status) : null,
        props.children)
    }

    function DeepSeekKeyCard(props) {
      const t = props.t
      const entry = props.entry
      const summary = props.summary
      const selection = useSelection()
      const row = entry.ok ? pickBalanceRow(entry.data && entry.data.balance_infos) : null
      const total = toNumberOrNull(row && row.total_balance)
      const granted = toNumberOrNull(row && row.granted_balance)
      const topped = toNumberOrNull(row && row.topped_up_balance)
      const currency = row !== null && row.currency === 'USD' ? '$' : '¥'
      const lowBalance = toNumberOrNull(summary.lowBalance) ?? 20
      const unavailable = entry.ok && entry.data && entry.data.is_available === false
      const valueTone = total !== null && (total <= lowBalance || unavailable) ? 'dauw-warn' : ''
      const fmt = (n) => (n === null ? '—' : `${currency}${n % 1 === 0 ? n.toFixed(0) : n.toFixed(2)}`)
      const spend = spendSummaryOf(entry.spend)
      const recent = summary.spend && Array.isArray(summary.spend.recent) ? summary.spend.recent : []
      return h(CardShell, {
        t,
        icon: KEY_ICON,
        title: entry.label,
        tail: entry.tail !== '' ? `···${entry.tail}` : null,
        value: row !== null ? fmt(total) : null,
        valueTone,
        checked: sourceVisible(summary, entry.id),
        onToggle: (next) => postJson('/api-usage/visibility', { id: entry.id, visible: next }),
        badgeActive: effectiveSelection(summary, selection) === entry.id,
        onPickBadge: () => writeLocalSelection(entry.id),
        footer: h('div', null,
          !entry.configured ? h('p', { className: 'dauw-error' }, t('key.missing')) : null,
          entry.ok === false && entry.error !== null ? h('p', { className: 'dauw-error' }, String(entry.error)) : null),
      },
        h(SpendLine, { t, spend, status: row !== null ? (unavailable ? t('key.unavailable') : t('key.available')) : null },
          granted !== null ? h('span', null, t('key.granted', { value: fmt(granted) })) : null,
          topped !== null ? h('span', null, t('key.topped', { value: fmt(topped) })) : null),
        h(MiniBars, { t, days: recent, calendar: summary.spend && summary.spend.calendar, providerId: entry.origin }))
    }

    function AccountCard(props) {
      const t = props.t
      const account = props.account
      const summary = props.summary
      const selection = useSelection()
      if (account === null || account === undefined || !account.available) {
        return h('div', { className: 'dauw-card' },
          h('div', { className: 'dauw-card-top' },
            h('span', { className: 'dauw-card-icon' }, ACCOUNT_ICON),
            h('span', { className: 'dauw-card-title' }, t('account.title')),
            h('span', { className: 'dauw-card-tail' }, t('account.unavailable'))))
      }
      if (!account.signedIn) {
        return h('div', { className: 'dauw-card' },
          h('div', { className: 'dauw-card-top' },
            h('span', { className: 'dauw-card-icon' }, ACCOUNT_ICON),
            h('span', { className: 'dauw-card-title' }, t('account.title')),
            h('span', { className: 'dauw-card-tail' }, t('account.signedOut'))))
      }
      const profile = account.profile
      const rows = account.balance && Array.isArray(account.balance.value) ? account.balance.value : []
      const bonus = account.balance && Array.isArray(account.balance.bonusWallets) ? account.balance.bonusWallets : []
      const primary = rows.find((r) => r.currency === 'CNY') ?? rows[0] ?? null
      const currency = primary !== null && primary.currency === 'USD' ? '$' : '¥'
      const total = toNumberOrNull(primary && primary.balance)
      const name = (profile && (profile.name || profile.contact)) || ''
      const spend = spendSummaryOf(account.spend)
      const recent = summary.spend && Array.isArray(summary.spend.recent) ? summary.spend.recent : []
      const walletLinks = h('div', { className: 'dauw-card-sub' },
        account.links && account.links.usageUrl ? h('a', { className: 'dauw-link', href: account.links.usageUrl, target: '_blank', rel: 'noreferrer' }, t('account.usage')) : null,
        account.links && account.links.topUpUrl ? h('a', { className: 'dauw-link', href: account.links.topUpUrl, target: '_blank', rel: 'noreferrer' }, t('account.topUp')) : null)
      return h(CardShell, {
        t,
        icon: ACCOUNT_ICON,
        avatar: profile && profile.avatarUrl ? profile.avatarUrl : null,
        title: name !== '' ? name : t('account.title'),
        tail: null,
        value: primary !== null
          ? `${currency}${total !== null && total % 1 === 0 ? total.toFixed(0) : total !== null ? total.toFixed(2) : '—'}`
          : null,
        checked: sourceVisible(summary, 'account'),
        onToggle: (next) => postJson('/api-usage/visibility', { id: 'account', visible: next }),
        badgeActive: effectiveSelection(summary, selection) === 'account',
        onPickBadge: () => writeLocalSelection('account'),
      },
        h(SpendLine, { t, spend, status: primary !== null ? t('key.available') : null },
          bonus.length > 0
            ? h('span', null, `${t('account.bonus')}: ${bonus.map((r) => t('account.wallet', { currency: r.currency === 'USD' ? '$' : '¥', balance: r.balance })).join(' · ')}`)
            : null,
          rows.length > 1
            ? rows.map((r, i) => h('span', { key: i }, t('account.wallet', { currency: r.currency === 'USD' ? '$' : '¥', balance: r.balance })))
            : null),
        h(MiniBars, { t, days: recent, calendar: summary.spend && summary.spend.calendar, providerId: 'deepseek-account' }),
        walletLinks)
    }

    function GlmKeyCard(props) {
      const t = props.t
      const entry = props.entry
      const summary = props.summary
      const selection = useSelection()
      const data = entry.ok ? entry.data : null
      const windows = data !== null && data.windows ? data.windows : {}
      const hasAnyWindow = windows.session !== null || windows.weekly !== null || windows.mcp !== null
      const sessionPct = toNumberOrNull(windows.session && windows.session.percentage)
      return h(CardShell, {
        t,
        icon: KEY_ICON,
        title: entry.label,
        tail: entry.tail !== '' ? `···${entry.tail}` : null,
        value: sessionPct !== null
          ? `${Math.round(sessionPct)}%`
          : null,
        valueTone: sessionPct !== null && sessionPct >= 95 ? 'dauw-bad' : sessionPct !== null && sessionPct >= 80 ? 'dauw-warn' : '',
        checked: sourceVisible(summary, entry.id),
        onToggle: (next) => postJson('/api-usage/visibility', { id: entry.id, visible: next }),
        badgeActive: effectiveSelection(summary, selection) === entry.id,
        onPickBadge: () => writeLocalSelection(entry.id),
        footer: h('div', null,
          !entry.configured ? h('p', { className: 'dauw-error' }, t('key.missing')) : null,
          entry.ok === false && entry.error !== null ? h('p', { className: 'dauw-error' }, String(entry.error)) : null),
      },
        data !== null && data.level !== ''
          ? h('div', { className: 'dauw-card-sub' }, h('span', null, t('glm.level', { level: levelToLabel(data.level) })))
          : entry.ok && !hasAnyWindow ? h('div', { className: 'dauw-card-sub' }, h('span', null, t('glm.noPlan')))
            : null,
        h(WindowRow, { t, window: windows.session, label: t('glm.window5h'), unit: 'glm.quota' }),
        h(WindowRow, { t, window: windows.weekly, label: t('glm.weekly'), unit: 'glm.quota' }),
        h(WindowRow, { t, window: windows.mcp, label: t('glm.mcp'), unit: 'glm.quotaCalls' }),
        data !== null && data.today !== null
          ? h('div', { className: 'dauw-card-sub' },
              h('span', { style: { fontWeight: 600 } }, t('glm.today')),
              data.today.credits !== null ? h('span', null, t('glm.todayCredits', { credits: formatCredits(data.today.credits) })) : null,
              data.today.tokens !== null ? h('span', null, t('glm.todayTokens', { tokens: formatTokens(data.today.tokens) })) : null)
          : null)
    }

    function KeyManager(props) {
      const t = props.t
      const [keys, setKeys] = React.useState([])
      const [vendor, setVendor] = React.useState('deepseek')
      const [label, setLabel] = React.useState('')
      const [key, setKey] = React.useState('')
      const [busy, setBusy] = React.useState(false)
      const [notice, setNotice] = React.useState(null)

      const reload = React.useCallback(async () => {
        try {
          const response = await fetch('/api-usage/keys', { method: 'GET', cache: 'no-store' })
          const json = await response.json()
          if (json && json.ok && Array.isArray(json.keys)) setKeys(json.keys)
        } catch {
          /* keep the previous list */
        }
      }, [])

      React.useEffect(() => {
        reload()
      }, [reload])

      const submit = async () => {
        if (key.trim() === '' || busy) return
        setBusy(true)
        setNotice(null)
        try {
          const response = await fetch('/api-usage/keys', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ action: 'add', vendor, label, key }),
          })
          const json = await response.json()
          if (json && json.ok) {
            setNotice({ tone: 'ok', text: t('keys.saved', { label: label.trim() !== '' ? label.trim() : json.id }) })
            setLabel('')
            setKey('')
            await reload()
            setTimeout(() => { loadSummary() }, 400)
          } else {
            setNotice({ tone: 'bad', text: t('keys.failed', { message: (json && (json.message || json.error)) || '?' }) })
          }
        } catch (err) {
          setNotice({ tone: 'bad', text: t('keys.failed', { message: (err && err.message) || String(err) }) })
        } finally {
          setBusy(false)
        }
      }

      const remove = async (id) => {
        setBusy(true)
        setNotice(null)
        try {
          const response = await fetch('/api-usage/keys', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ action: 'remove', id }),
          })
          const json = await response.json()
          if (json && json.ok) {
            setNotice({ tone: 'ok', text: t('keys.removed') })
            await reload()
            setTimeout(() => { loadSummary() }, 400)
          } else {
            setNotice({ tone: 'bad', text: t('keys.failed', { message: (json && (json.error || json.message)) || '?' }) })
          }
        } catch (err) {
          setNotice({ tone: 'bad', text: t('keys.failed', { message: (err && err.message) || String(err) }) })
        } finally {
          setBusy(false)
        }
      }

      return h('section', { className: 'dauw-group' },
        h('div', { className: 'dauw-group-title' },
          h('b', null, t('keys.title')),
          h('span', null, t('sources.count', { count: String(keys.length) }))),
        h('div', { className: 'dauw-card' },
          h('p', { className: 'dauw-notice' }, t('keys.hint')),
          h('div', { className: 'dauw-form' },
            h('select', {
              className: 'dauw-select',
              value: vendor,
              onChange: (event) => setVendor(event.target.value),
            },
              h('option', { value: 'deepseek' }, t('vendor.deepseek')),
              h('option', { value: 'glm' }, t('vendor.glm'))),
            h('input', {
              className: 'dauw-input dauw-label',
              type: 'text',
              placeholder: t('keys.labelPlaceholder'),
              value: label,
              onChange: (event) => setLabel(event.target.value),
            }),
            h('input', {
              className: 'dauw-input dauw-grow',
              type: 'password',
              placeholder: t('keys.keyPlaceholder'),
              value: key,
              onChange: (event) => setKey(event.target.value),
              onKeyDown: (event) => { if (event.key === 'Enter') submit() },
            }),
            h('button', {
              type: 'button',
              className: 'dauw-button',
              disabled: busy || key.trim() === '',
              onClick: submit,
            }, busy ? t('keys.adding') : t('keys.add'))),
          notice !== null
            ? h('p', { className: notice.tone === 'bad' ? 'dauw-error' : 'dauw-page-sub' }, notice.text)
            : null),
        keys.length === 0
          ? h('div', { className: 'dauw-managed' }, h('span', { className: 'dauw-managed-name dauw-page-sub' }, t('keys.empty')))
          : keys.map((entry) => h('div', { key: entry.id, className: 'dauw-managed' },
              h('span', { className: 'dauw-managed-name' },
                entry.label,
                entry.tail !== '' ? h('span', { className: 'dauw-managed-tag' }, ` ···${entry.tail}`) : null),
              h('span', { className: 'dauw-managed-tag' }, entry.vendor === 'glm' ? t('vendor.glm') : t('vendor.deepseek')),
              h('button', {
                type: 'button',
                className: 'dauw-button dauw-danger',
                disabled: busy,
                onClick: () => remove(entry.id),
              }, t('keys.remove')))))
    }

    function SettingsPage(props) {
      const t = props.t
      const state = consumeSummary()
      const [busy, setBusy] = React.useState(false)

      const refresh = async () => {
        setBusy(true)
        try {
          await loadSummary()
        } finally {
          setBusy(false)
        }
      }

      let body
      if (state.phase === 'loading') {
        body = h('p', { className: 'dauw-page-sub' }, t('state.loading'))
      } else if (state.phase === 'error') {
        body = h('p', { className: 'dauw-error' }, t('settings.failed', { message: state.message || '?' }))
      } else {
        const summary = state.summary
        const dsCount = (summary.deepseek || []).length
        const glmCount = (summary.glm || []).length
        body = [
          dsCount > 0 || (summary.account && summary.account.available)
            ? h('section', { key: 'ds', className: 'dauw-group' },
                h('div', { className: 'dauw-group-title' },
                  h('b', null, 'DeepSeek'),
                  h('span', null, t('sources.count', { count: String(dsCount + (summary.account && summary.account.signedIn ? 1 : 0)) }))),
                h(AccountCard, { t, account: summary.account, summary }),
                ...(summary.deepseek || []).map((entry) => h(DeepSeekKeyCard, { key: entry.id, t, entry, summary })))
            : null,
          glmCount > 0
            ? h('section', { key: 'glm', className: 'dauw-group' },
                h('div', { className: 'dauw-group-title' },
                  h('b', null, 'GLM Coding Plan'),
                  h('span', null, t('sources.count', { count: String(glmCount) }))),
                ...(summary.glm || []).map((entry) => h(GlmKeyCard, { key: entry.id, t, entry, summary })))
            : null,
          h('section', { key: 'src', className: 'dauw-group' },
            h('div', { className: 'dauw-group-title' }, h('b', null, t('sources.title'))),
            h('div', { className: 'dauw-card' }, h('p', { className: 'dauw-notice' }, t('sources.hint')))),
          h(KeyManager, { t }),
        ]
      }

      return h('div', { className: 'dauw-page' },
        h('div', { className: 'dauw-page-head' },
          h('h2', { className: 'dauw-page-title' }, t('settings.title')),
          h('button', {
            type: 'button',
            className: 'dauw-button',
            disabled: busy || state.phase === 'loading',
            onClick: refresh,
          }, REFRESH_ICON, busy ? t('settings.refreshing') : t('settings.refresh')),
          state.phase === 'ready' && state.summary.fetchedAt
            ? h('p', { className: 'dauw-page-sub' }, t('settings.updated', { time: formatTime(state.summary.fetchedAt) }))
            : null),
        body)
    }

    /* ── registration ──────────────────────────────────────────────────── */

    const inject = ['slots', 'locale']

    function apply(ctx) {
      /* A plugin reload in the same page can leave the previous activation's
       * locale namespace registered, and re-registering it throws. A unique
       * namespace per activation keeps the newest dictionary live; the stale
       * one is unreferenced and disappears on the next page load. */
      const localeNs = `apiUsage${Math.random().toString(36).slice(2, 8)}`
      const disposeLocale = ctx.locale.register(localeNs, { zh: ZH, en: EN })
      const t = ctx.locale.bind(localeNs)

      /* Composer tool row keeps a compact badge; the sidebar footer is left
       * entirely to other plugins. */
      const disposeBadge = ctx.slots.inject('conversation.input.right', () =>
        ctx.slots.register({
          name: 'conversation.input.right',
          id: 'api-usage',
          order: 10,
        }, (props) => h(Badge, Object.assign({}, props, { t }))))

      const disposeSection = ctx.slots.inject('settings.section', () =>
        ctx.slots.register({
          name: 'settings.section',
          id: 'api-usage',
          order: 40,
          label: () => t('settings.title'),
        }, (props) => h(SettingsPage, Object.assign({}, props, { t }))))

      const disposeIcon = ctx.slots.inject('settings.section.icon', () =>
        ctx.slots.register({
          name: 'settings.section.icon',
          /* list slot addressed by the matching settings.section id */
          id: 'api-usage',
        }, () => PAGE_ICON))

      /* The manager dialog rides the shell overlay so the badge can open it
       * without driving the internal Settings dialog. */
      const disposeManager = ctx.slots.inject('shell.overlay', () =>
        ctx.slots.register({
          name: 'shell.overlay',
          id: 'api-usage-manager',
          order: 60,
        }, (props) => h(ManagerDialog, Object.assign({}, props, { t }))))

      return () => {
        disposeManager()
        disposeIcon()
        disposeSection()
        disposeBadge()
        disposeLocale()
      }
    }

    return { inject, apply }
  },
})

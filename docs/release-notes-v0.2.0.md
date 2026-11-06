首个发布版本。

## 功能

- **输入框徽标**：显示当前选中数据源的 DeepSeek 余额/今日消耗或 GLM 5 小时配额，点击刷新，悬浮展开数据源面板（点击切换显示对象）
- **管理弹窗 / 设置页**（同一份界面）：逐 key 卡片，含星星设为徽标、显示开关、今日消耗、赠金/充值余额
- **ECharts 图表**：每个数据源近 7 天柱状图 + 近 90 天日历热力图（内联打包，无 CDN 依赖）
- **GLM Coding Plan**：5 小时 / 周 / MCP 额度进度条、已用积分、重置倒计时、今日消耗
- **DeepSeek 本地记账**：监听 `llm/stream`，按官方价格表计算今日消耗，按 provider 渠道（账号 / 各 API key）分别统计，持久化到 `$DSH_HOME/storages/api-usage/ledger.json`
- **多 key 管理**：自动从 LLM provider 配置发现 `apiKeyEnv`，也可在弹窗内直接添加任意多个 DeepSeek / GLM key（存 DSH 凭据库）

## 数据源

- DeepSeek 余额：`GET https://api.deepseek.com/user/balance`
- DeepSeek 账号：Host `deepseekAccount` 服务
- GLM 配额：`GET {host}/api/monitor/usage/quota/limit`
- GLM 今日消耗：`GET {host}/api/monitor/credit-usage/usage-detail`

## 安装

```bash
dsh plugin --profile desktop add github:Alfen2309/dsh-api-usage
```

## 安全

API key 只在 Host 进程解析使用，不进入浏览器；前端仅接收余额、配额、用量与 key 后 4 位掩码。

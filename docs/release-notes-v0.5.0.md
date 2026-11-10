v0.5.0 新增第三个数据源：**Codex（ChatGPT 订阅）用量**。插件现在可以读取本机 Codex CLI 已登录账号的订阅额度，在输入框徽标和管理页展示「主要 / 次要窗口」的已用百分比、重置倒计时与剩余 credits。

## 变更

- **新增 Codex 数据源**：宿主读取本机 `codex app-server` 的 `account/rateLimits/read`——先 `account/read` 确认登录类型是 ChatGPT，再取额度。无需粘贴任何 API key，登录凭据与令牌刷新都由 Codex 自己负责。数据源可独立开关是否计入徽标聚合，也可单选为徽标数据源（如 `📊 53% 已用`）。
- **Codex 卡片**：显示套餐类型、主要 / 次要窗口的已用百分比进度条与重置倒计时、剩余 credits（或不限量）。窗口按官方时长自动标注为「5 小时窗口 / 7 天窗口」。百分比是**已用量**（越高越接近限流），≥80% 变黄、≥95% 变红。
- **与 `dsh-codex-subscription` 联动**：若该插件已安装且已登录 ChatGPT，直接复用它的额度读数（页面 RPC `/codex-subscription` → `usage/accounts`），卡片标注「额度来源：Codex Subscription 插件」。未安装、未登录或读取失败时，自动回退到本机 Codex CLI 查询；两者都不可用时明确区分「未登录 / 未找到 CLI / 查询失败」三种状态。
- **CLI 定位**：默认依次查找桌面 profile 里的 `@openai/codex`、当前模块依赖、PATH 上的 `codex`；特殊情况可用新增配置项 `codexCommand` 指定可执行文件或 `codex.js` 路径。
- **安全与脱敏**：Codex 结果只向浏览器返回套餐类型、额度窗口与 credits；账号 ID、邮箱、令牌与原始错误均不外传。查询有 12 秒超时与 256 KiB 输出上限，多标签页并发时共享同一次查询。
- **工程**：新增 `codex-usage.js` 与 `test/`（Node 内置 `node --test`，5 个用例覆盖协议握手、命令行登录、服务端错误与脱敏），`npm test` 可跑；`npm run check` 覆盖新文件；`dsh.client.inject` 增加 `@deepseek-ai/dsh-client-connection` 以调用联动 RPC；`package-lock.json` 版本同步对齐 0.5.0。

## 说明

- Codex 额度是 **ChatGPT 订阅**产品，与普通 OpenAI API key 的计费是两套体系；插件只查前者。用 API key 登录 Codex 时没有订阅额度，卡片会提示先登录 ChatGPT 账号。
- `summary` 接口只是**新增** `codex` 字段，旧前端忽略即可，无破坏性变更。
- Codex 数据源自带 `src/client.js` 中英双语文案，`client.js` 构建产物已同步重新构建。
- 升级后请刷新页面；宿主侧改动需重启 DSH（或插件重载）后生效。本机未安装 Codex CLI 时该数据源显示「未找到 Codex CLI」，其余功能不受影响。

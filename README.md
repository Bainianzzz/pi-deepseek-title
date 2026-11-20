# pi-deepseek-title

为 pi 增加 DeepSeek 会话标题：新对话的第一条请求自动带上 `"title": {"enabled": true}`，把响应里的标题写成会话名：

- footer 路径行显示 `~/cwd (branch) • 标题`（原生会话名行为）
- `/resume` 会话列表显示标题，而不是首条用户消息

接口文档：[会话标题](https://api-docs.deepseek.com/zh-cn/guides/conversation_title)

## 行为

- 只处理 Responses 模式（`api === "openai-responses"`，即 DeepSeek 自动生成标题的模式），且仅当模型走 DeepSeek 端点（`provider` 或 `baseUrl` 含 `deepseek`）。
- 只在会话的第一次 provider 请求上加 `title` 字段；拿到标题后不再开启。
- 已经 resume 的会话（分支里已有 assistant 消息）或已有会话名的会话不再请求标题。
- 标题来自 `response.completed` 事件的 `response.title`，在 assistant 消息落盘后写成会话名。
- 标题为空（拒答、报错、纯工具调用回合）时不写会话名，`/resume` 列表回退到首条用户消息。
- 不处理 `/name` 重命名：标题只来自 DeepSeek 的首次响应。
- 非 TUI 模式（`pi -p`、RPC）同样写入会话名。

## 安装

```bash
pi install git:github.com/Bainianzzz/pi-deepseek-title
```

## 已知取舍

- 标题依赖服务端返回；某些网关会丢弃未知的顶层字段 `title`，此时插件静默不写会话名，不影响请求本身。
- 标题显示为会话名，因此也会出现在终端标题里（pi 原生行为）。

## 开发

```bash
npm install
npm run typecheck
```

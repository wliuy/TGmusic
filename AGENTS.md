# TGmusic 项目约定

Cloudflare Pages + D1 + Telegram Bot API 的私有音乐库。前端单文件 `index.html`（内联 JS），后端在 `functions/api/`。

## 版本号规则（每次推送必须执行）

推送前把 `index.html` 里的版本号**最后一位加 1**。版本号出现在两处，必须同时改：

- 约第 395 行：`<p class="brand-sub">Premium Music Hub | v10.2.2</p>`
- 约第 506 行：`<span ...>v10.2.2</span>`

```
sed -i 's/v10\.2\.2/v10.2.3/g' index.html
```

## 双部署（Pages + Workers）

同一套代码同时支持两种部署，互不干扰：

- **Pages**：靠 `functions/` 目录自动路由，`wrangler.toml` 因缺少 `pages_build_output_dir` 被忽略，配置仍由控制台管理。
- **Workers**：`worker/index.js` 把 5 个 `onRequest` 按路径分发，`wrangler.toml` 里 `main` + `assets` + D1 绑定。

`wrangler.toml` 绝不能加 `pages_build_output_dir`，否则会接管 Pages 配置、覆盖控制台的 D1 绑定和环境变量。

静态资源目录是 `.`，靠 `.assetsignore` 挡住源码。**新增顶层文件或目录时必须同步加进 `.assetsignore`**，否则会被当静态文件公开。当前只上传 9 个文件（`index.html`、`sw.js`、`manifest.json`、`assets/` 下 6 个）。

### 三条不能破的规矩

1. **`database_id` 必须是占位符 `REPLACE_WITH_YOUR_D1_DATABASE_ID`**，绝不能写真实 ID。仓库是 public，别人 fork 走要能绑自己的库。
2. **`keep_vars = true` 不能删**。删了每次 `wrangler deploy` 都会清空控制台的 `PASSWORD` / `TG_Bot_Token` / `TG_Chat_ID`。
3. **`wrangler.toml` 是 Workers 的唯一真相源**。部署时文件里的绑定会覆盖控制台手动绑的，这是官方设计，不是 bug。

## 密码

`env.PASSWORD || "sarah"` 是唯一鉴权方式，由用户在 Cloudflare 控制台设置 `PASSWORD` 环境变量。
代码里的 `"sarah"` 只是默认值，不要修改。鉴权入口共 5 处：`check_auth.js`、`songs.js`、`stream.js`、`upload.js`、`manage.js`。

## 约束

- 仓库是 public，**任何 token / 密码 / 密钥都不能写进代码**，只在 Cloudflare 控制台配环境变量。
- 不要添加 `wrangler.toml`：它会覆盖控制台里的 D1 绑定与环境变量。
- 不要引入 Cookie 会话登录，保持单密码的极简方案。
- 用户要求直接推 `main`，不开 PR。

## 已知坑

- Telegram `file_id` 绑定上传它的那个 bot。换 bot token 会导致所有音频/封面 `wrong file_id`。库里数据属于 bot `1994057189`。
- Bot API 下载上限 20MB，超限文件能上传成功但永远播不了，`upload.js` 已提前拦截。
- APlayer 列表不能直接改 `ap.list.audios`，必须走 `list.clear()`/`add()` 重建，否则 `switch()` 越界，表现为"点了歌没反应"。
- Service Worker 用网络优先。缓存优先会导致代码更新后刷新仍是旧版。

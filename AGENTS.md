# TGmusic 项目约定

Cloudflare Workers + D1 + Telegram Bot API 的私有音乐库。前端单文件 `index.html`（内联 JS），业务逻辑在 `functions/api/`，`worker/index.js` 是 Workers 入口。

## 版本号规则（每次推送必须执行）

推送前把 `index.html` 里的版本号**最后一位加 1**。版本号出现在两处，必须同时改：

- 约第 395 行：`<p class="brand-sub">Premium Music Hub | v10.2.4</p>`
- 约第 506 行：`<span ...>v10.2.4</span>`

```
sed -i 's/v10\.2\.4/v10.2.5/g' index.html
```

## 部署架构

**Workers 是主部署**，Pages 是可选兼容路径。

- **Workers**：`worker/index.js` 从 `functions/api/` 具名导入 6 个 `onRequest`，按路径分发；其余请求交给 `env.ASSETS`。`wrangler.toml` 里配 `main` + `assets` + D1 绑定。
- **Pages**（可选）：靠 `functions/` 目录自动路由，`wrangler.toml` 因缺少 `pages_build_output_dir` 被忽略。

`functions/api/` 不是 Pages 专用代码，**删掉它 Worker 会直接崩**。它承载全部业务逻辑。

`wrangler.toml` 绝不能加 `pages_build_output_dir`，否则会接管 Pages 配置、覆盖控制台的 D1 绑定和环境变量。

静态资源目录是 `.`，靠 `.assetsignore` 挡住源码。**新增顶层文件或目录时必须同步加进 `.assetsignore`**，否则会被当静态文件公开。当前只上传 9 个文件（`index.html`、`sw.js`、`manifest.json`、`assets/` 下 6 个）。

### 三条不能破的规矩

1. **`database_id` 必须写真实的 ID，不能用占位符**。Cloudflare Git 集成部署（CI）不会交互式询问，占位符会直接报 `binding DB of type d1 must have a valid database_id specified`。副作用：这个 ID 会公开在仓库里，但 D1 ID 本身不是密钥（没有账号权限读不到数据），风险可接受。
2. **`keep_vars = true` 不能删**。删了每次 `wrangler deploy` 都会清空控制台的 `PASSWORD` / `TG_Bot_Token` / `TG_Chat_ID` / `SITE_TITLE`。
3. **`wrangler.toml` 是 Workers 的唯一真相源**。部署时文件里的绑定会覆盖控制台手动绑的，这是官方设计，不是 bug。删掉 `[[d1_databases]]` 段会导致 D1 绑定被删除（4.81 不支持 `keep_bindings`）。

### `name` 必须和实际 Worker 一致

当前 `name = "tgmusic"`。Cloudflare Git 集成部署会用 `WRANGLER_CI_OVERRIDE_NAME` 覆盖它，但本地 `wrangler deploy` 不会。名字写错会新建一个空 Worker，原 Worker 不受影响，等于白部署。

## 密码与标题

`env.PASSWORD || "sarah"` 是唯一鉴权方式，由用户在 Cloudflare 控制台设置 `PASSWORD` 环境变量。
代码里的 `"sarah"` 只是默认值，不要修改。鉴权入口共 5 处：`check_auth.js`、`songs.js`、`stream.js`、`upload.js`、`manage.js`。

`env.SITE_TITLE || "TGmusic"` 控制全站显示名称，由 `functions/api/site.js` 提供，前端脚本加载时拉取并写入 DOM。默认值 `TGmusic`。

### 品牌文字 vs 内部标识符

改品牌名时**只改显示文字**，绝不能碰内部标识符：

| 可以改 | 绝不能改 |
|---|---|
| `<title>`、`#auth-title`、`#brand-title`、`#m-brand-title`、`#app-title-meta`、`manifest.json` 的 `name` | `sarah_key` / `sarah_auth`（localStorage 键，改了所有人掉线） |
| 播放器专辑名（用 `SITE_TITLE` 变量） | `.sarah-dialog-*` CSS 类、`showSarahDialog()` / `closeSarahDialog()` 函数名 |

## 约束

- 仓库是 public，**任何 token / 密码 / 密钥都不能写进代码**，只在 Cloudflare 控制台配环境变量。
- 不要引入 Cookie 会话登录，保持单密码的极简方案。
- 用户要求直接推 `main`，不开 PR。

## 已知坑

- Telegram `file_id` 绑定上传它的那个 bot。换 bot token 会导致所有音频/封面 `wrong file_id`。库里数据属于 bot `1994057189`。
- Bot API 下载上限 20MB，超限文件能上传成功但永远播不了，`upload.js` 已提前拦截。
- APlayer 列表不能直接改 `ap.list.audios`，必须走 `list.clear()`/`add()` 重建，否则 `switch()` 越界，表现为"点了歌没反应"。
- Service Worker 用网络优先。缓存优先会导致代码更新后刷新仍是旧版。
- 新增 API 时**两个地方都要加**：`functions/api/xxx.js` 建文件 + `worker/index.js` 的 `ROUTES` 注册。只加前者的话 Pages 能用、Worker 404。

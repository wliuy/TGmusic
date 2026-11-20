# TGmusic 🎵

基于 Cloudflare Workers 与 Telegram 的极简云端私人音乐库。

## 🌟 项目特性

- **Serverless 架构**：依托 Cloudflare Workers 构建，无需传统服务器。
- **TG 免费存储**：深度对接 Telegram API，实现音频与封面的无限免费存储。
- **多端适配**：支持 PC 端沉浸式毛玻璃 UI 与移动端专属播放器界面。
- **访问认证**：内置环境变量密码防护，全方位保护你的私人曲库。

## 🚀 极速部署指南

**前提条件**：拥有 GitHub、Cloudflare 账号，并已准备好 Telegram 的 Bot Token 和数据存储群组的 Chat ID。

### 1. 获取代码
直接点击右上角将本项目 **Fork** 到你的 GitHub 账号下，然后克隆到本地：

```sh
git clone https://github.com/<你的用户名>/TGmusic.git
cd TGmusic
npx wrangler login
```

### 2. 创建 D1 数据库
进入 Cloudflare 控制台 -> **Workers & Pages** -> **D1 SQL Database**，新建一个数据库（名称随意，例如 `sarah-db`），代码运行后会自动建表，无需手动操作。

建好后执行 `npx wrangler d1 list` 拿到数据库 ID。

### 3. 填入数据库 ID

打开 `wrangler.toml`，把最后一行换成你自己的 D1 ID：

```toml
database_id = "你的 D1 数据库 ID"
```

> 这一行必须填真实的 ID。Cloudflare 的 Git 集成部署不会交互式询问，留占位符会直接报错。

### 4. 首次部署

```sh
npx wrangler deploy
```

### 5. 设置变量与密钥

D1 绑定已经写在 `wrangler.toml` 里，不用在控制台重复绑。但下面几个变量要单独设：

```sh
npx wrangler secret put TG_Bot_Token
npx wrangler secret put TG_Chat_ID
npx wrangler secret put PASSWORD
```

或者在控制台 **Workers & Pages → 你的 Worker → Settings → Variables** 里添加，名字必须完全一致：

| 变量名 | 必填 | 说明 |
|---|---|---|
| `TG_Bot_Token` | 是 | Telegram 机器人 Token |
| `TG_Chat_ID` | 是 | Telegram 存储群组 ID |
| `PASSWORD` | 否 | 访问密码。**不设则站点完全公开**（谁都能访问） |
| `SITE_TITLE` | 否 | 网站标题（不设则默认 `TGmusic`） |

### 6. 之后每次部署

```sh
npx wrangler deploy
```

`wrangler.toml` 里的 `keep_vars = true` 会保住你在控制台或 secret 里设的变量，不会被覆盖清空。

> ⚠️ 数据库绑定以 `wrangler.toml` 为准。如果你习惯在控制台点绑定，注意每次 `wrangler deploy` 都会用文件里的配置覆盖它。

部署完成后，打开分配的 `*.workers.dev` 域名，输入密码即可进入你的专属音乐库。

---

## 🎨 自定义网站标题

设置 `SITE_TITLE` 环境变量后，页面标题、登录页、首页标题、手机端头部、系统播放器专辑名会一起变：

```sh
npx wrangler secret put SITE_TITLE
```

输入比如 `小刘的音乐盒`，刷新页面即可生效。不设置就用默认的 `TGmusic`。

> 浏览器标签页标题和 PWA 名称会跟随。已安装到桌面的 PWA 需要重新添加才会更新图标名称。

---

## 🗂 项目结构

```
index.html          前端单文件（内联 JS/CSS）
functions/api/      后端业务逻辑，6 个 API
worker/index.js     Workers 入口，按路径分发到 functions/api
wrangler.toml       Workers 配置（D1 绑定、静态资源）
.assetsignore       上传白名单，防止源码泄露
assets/             APlayer、Tailwind、站点图标等静态资源
sw.js               Service Worker
manifest.json       PWA 配置
```

> `functions/api/` 不是 Pages 专用代码，`worker/index.js` 正是从这里导入业务逻辑的。**删掉或改名它，两条部署路径都会崩。**

---

## 🧹 清理 Pages 部署（可选）

本项目现在只需要 Workers。`functions/api/` 目录名是 Pages 的路由约定，但 Workers 也直接导入它，**别删也别改名**。

如果你之前建过 Pages 项目，想删掉它：

### 部署数超过 100 时删不掉

Cloudflare 控制台会拒绝删除，这是[已知问题](https://developers.cloudflare.com/pages/platform/known-issues/#delete-a-project-with-a-high-amount-of-deployments)。必须先清理部署。

```sh
npx wrangler login
./scripts/delete-pages-deployments.sh <你的项目名>
npx wrangler pages project delete <你的项目名> -y
```

第一条登录，第二条保留 production 部署、删掉所有 preview 部署，第三条删项目。`-y` 是跳过确认。

也可以不用脚本，直接用 API 分页删除，但部署多的时候很慢。

依赖 `jq`（`brew install jq` 或 `apt install jq`）。

> ⚠️ 删 Pages 项目不影响数据。音频都存在 Telegram，歌单信息在 D1，Worker 用的是同一个库。

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
database_id = "REPLACE_WITH_YOUR_D1_DATABASE_ID"
```

> 不改这一行直接部署会报错，这是故意的，防止误连别人的库。

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
| `PASSWORD` | 否 | 访问密码（不设则默认 `sarah`） |
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
assets/             APlayer、Tailwind 等静态依赖
sw.js               Service Worker
manifest.json       PWA 配置
```

> `functions/api/` 不是 Pages 专用代码，`worker/index.js` 正是从这里导入业务逻辑的。**删掉它 Worker 会直接崩。**

---

## 🔁 可选：部署到 Pages

Workers 已经够用，Pages 不是必需的。只有当你需要 Pages 特有功能（比如免费无限静态请求、Git 分支预览）时才需要它。

用同一套代码，Pages 靠 `functions/` 目录自动路由，`wrangler.toml` 会被忽略（因为缺少 `pages_build_output_dir`）。

### 1. 创建 Pages 部署
1. 在 Cloudflare 控制台点击 **Create application** -> **Pages** -> **Connect to Git**。
2. 选中你 Fork 的仓库。
3. 构建设置全部保持默认（Framework preset: `None`，Build command 和 output directory 留空）。
4. 点击 **Save and Deploy**（注：首次部署完访问会报错，直接进入下一步配置）。

### 2. 绑定数据库与变量
进入该 Pages 项目的管理面板：

* **绑定数据库**：进入 **Settings** -> **Functions** -> **D1 database bindings**。点击 Add binding，Variable name 必须填 `DB`，数据库选择你刚才创建的 D1 库。
* **设置环境变量**：进入 **Settings** -> **Environment variables**，添加变量（同上表）。

### 3. 重新部署生效
回到该项目的 **Deployments** 选项卡，找到最新的一条部署记录，点击右侧的 `...` 选择 **Retry deployment**。

部署完成后，打开分配的 `*.pages.dev` 域名，输入密码即可进入你的专属音乐库。

> 💡 两种部署可以同时存在，共用同一个 D1 库，数据完全一致。

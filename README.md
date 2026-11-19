# Sarah Music 🎵

基于 Cloudflare Pages 与 Telegram 的极简云端私人音乐库。

## 🌟 项目特性

- **Serverless 架构**：依托 Cloudflare Pages 与 Functions 构建，无需传统服务器。
- **TG 免费存储**：深度对接 Telegram API，实现音频与封面的无限免费存储。
- **多端适配**：支持 PC 端沉浸式毛玻璃 UI 与移动端专属播放器界面。
- **访问认证**：内置环境变量密码防护，全方位保护你的私人曲库。

## 🚀 极速部署指南

**前提条件**：拥有 GitHub、Cloudflare 账号，并已准备好 Telegram 的 Bot Token 和数据存储群组的 Chat ID。

### 1. 获取代码
直接点击右上角将本项目 **Fork** 到你的 GitHub 账号下。

### 2. 创建 D1 数据库
进入 Cloudflare 控制台 -> **Workers & Pages** -> **D1 SQL Database**，新建一个数据库（名称随意，例如 `sarah-db`），代码运行后会自动建表，无需手动操作。

### 3. 创建 Pages 部署
1. 在 Cloudflare 控制台点击 **Create application** -> **Pages** -> **Connect to Git**。
2. 选中你刚 Fork 的仓库。
3. 构建设置全部保持默认（Framework preset: `None`，Build command 和 output directory 留空）。
4. 点击 **Save and Deploy**（注：首次部署完访问会报错，直接进入下一步配置）。

### 4. 绑定数据库与变量
进入该 Pages 项目的管理面板：

* **绑定数据库**：进入 **Settings** -> **Functions** -> **D1 database bindings**。点击 Add binding，Variable name 必须填 `DB`，数据库选择你刚才创建的 D1 库。
* **设置环境变量**：进入 **Settings** -> **Environment variables**，添加以下三个变量：
    * `TG_Bot_Token`：你的 Telegram 机器人 Token。
    * `TG_Chat_ID`：你的 Telegram 存储群组 ID。
    * `PASSWORD`：网站访问密码（不设置则默认为 `sarah`）。**改这个变量会让所有已登录设备立即退出**，可作为"踢掉所有设备"的手段。

### 5. 重新部署生效
回到该项目的 **Deployments** 选项卡，找到最新的一条部署记录，点击右侧的 `...` 选择 **Retry deployment**。

部署完成后，打开分配的 `*.pages.dev` 域名，输入密码即可进入你的专属音乐库。

## 🛠 本地开发

```bash
npm install
cp .dev.vars.example .dev.vars   # 填入自己的 Token / Chat ID / 密码
npx wrangler pages dev . --d1 DB=sarah-db
```

`wrangler.toml` 里的 `database_id` 需要替换成你 D1 库的真实 ID（`npx wrangler d1 list` 可查），仅本地调试时可以随意填。

## ⚠️ 已知限制

Telegram Bot API 的**文件下载上限为 20MB**（上传上限 50MB）。超过 20MB 的音频即使上传成功也无法播放，因此上传时会直接拦下并记录到上传日志。

## 🔐 登录机制

只用一个密码，没有账号体系：

1. 输入密码 → 服务端核对 → 下发一张签名过的会话 Cookie（`HttpOnly`，有效期 30 天）。
2. 之后所有请求自动携带这张 Cookie，**密码本身不再出现在任何请求或网址里**。
3. Cookie 由密码派生密钥签名，改 `PASSWORD` 即让全部旧会话失效。
4. 同一 IP 10 分钟内输错 8 次会被临时锁定。

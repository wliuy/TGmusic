# TGmusic 项目约定

Cloudflare Pages + D1 + Telegram Bot API 的私有音乐库。前端单文件 `index.html`（内联 JS），后端在 `functions/api/`。

## 版本号规则（每次推送必须执行）

推送前把 `index.html` 里的版本号**最后一位加 1**。版本号出现在两处，必须同时改：

- 约第 395 行：`<p class="brand-sub">Premium Music Hub | v10.2.1</p>`
- 约第 506 行：`<span ...>v10.2.1</span>`

```
sed -i 's/v10\.2\.1/v10.2.2/g' index.html
```

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

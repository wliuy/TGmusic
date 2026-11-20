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

线上只有 Workers。`functions/api/` 目录名沿用了 Pages 的路由约定，但代码本身不依赖 Pages，只用标准 `Request`/`Response`。

- `worker/index.js` 从 `functions/api/` 具名导入 6 个 `onRequest`，按路径分发；其余请求交给 `env.ASSETS`。
- `wrangler.toml` 配 `main` + `assets` + D1 绑定。

`functions/api/` 承载全部业务逻辑，**删掉或改名它 Worker 会直接崩**。想换目录名必须同步改 `worker/index.js` 的 6 个 import。

pages.dev 域名如果还活着，属于历史残留。删 Pages 项目前若部署数超过 100，控制台会拒绝，需先用 `scripts/delete-pages-deployments.sh` 清理 preview 部署。

不要加 `pages_build_output_dir`，那会让 wrangler 走 Pages 部署模式、覆盖 Workers 配置。

静态资源目录是 `.`，靠 `.assetsignore` 挡住源码。**新增顶层文件或目录时必须同步加进 `.assetsignore`**，否则会被当静态文件公开。当前只上传 12 个文件（`index.html`、`sw.js`、`manifest.json`、`assets/` 下 9 个，含 3 个图标）。

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
| `<title>`、`#auth-title`、`#brand-title`、`#m-brand-title`、`#app-title-meta`、`manifest.json` 的 `name`/`icons` | `sarah_key` / `sarah_auth`（localStorage 键，改了所有人掉线） |
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

## 移动端主题 / PWA 要点

- **状态栏不能和内容顶部撞色**：`.mobile-player-container` 的 background 第一层必须是
  `linear-gradient(180deg, var(--m-deep) 0%, var(--m-deep) 18%, transparent 42%)`，
  用不透明纯 deep 盖住下方光晕；光晕中心放 `at 50% 46%`（唱片区），不能放 `50% 0%`。
  JS 里 `updateBackground()` 的 `newGrad` 必须同款，否则 bg-stage 透明处露馅。
- **PWA 启动闪屏颜色只认 manifest.json** 的 `background_color` / `theme_color`，
  HTML 的 `<meta name="theme-color">` 管不到启动画面。
- **图标**：`icon.svg` 内容占比 76%（r=389/1024），四周留安全边距；
  `icon-maskable.svg` 是满铺矩形 + 图形 62%，供 Android 圆形裁切。
  改了 svg 必须重新生成 180/192/512 三个 png，并把新文件加进 sw.js 预缓存。
- **tailwind.css 是预编译产物**（`npm run build:css`）。改 index.html 的 class 后
  必须重新编译，否则新类名不存在。`focus:border-[var(--x)]/50` 这种「CSS 变量 + /透明度」
  组合 tailwind 编译不出来，要手写规则。

## 音频播放要点

- **APlayer `list.clear()` 会执行 `audio.src = ""`**。空字符串被浏览器解析成
  「当前页面 URL」，会拿 HTML 当音频解码 → 切歌瞬间爆一声电流杂音。
  `setupPlayer()` 里装了持久的 src/currentTime 守卫丢弃空值，**不要删除**。
- `freezeAudio()` 只切换 `isFreezingAudio` 标志位。**不要在里面临时
  `Object.defineProperty` + `delete`**，否则会把持久守卫一并删掉。
- 唱片转圈由 `syncDiscSpin(cur)` 依据 `currentTime` 是否真的推进来驱动，
  **不要在 `ap.on('play')` 里直接加 `.playing`**——play 只代表请求播放，
  加载中/卡缓冲时转圈会骗人。
- 播放进度记忆功能已按用户要求移除，不要加回来。

## 预载策略

- **不要在 `ap.on('play')` 里整曲预载下一首**。那会和正在缓冲的这首抢带宽，
  网速一般时当前曲目反而变慢。play 时只做 `warmHead()`（1.2MB Range 预热）。
- 整曲预载必须过 `preloadGateOpen()`：当前曲目缓冲 >=12 秒
  （或 >=15% 且 >=5 秒）才放行。每首只触发一次，切歌时重置 `preloadStartedFid`。
- 手动切歌必须检查 `nextBlob` 并复用，否则预载白下载（`handleTrackSwitch`）。
- `handleNext()` 必须用 `ap.nextIndex()`，不要自己 `Math.random()`：
  随机模式的顺序由 APlayer 的 `randomOrder` 决定，自己算会和预载对不上。

## 图标规范

图标是**自己手绘的实心图标**（24 视口）。试过 iconfont 那套，
造型不错但实心块把视口撑到 86%，在 16-19px 上又大又笨重，弃用。
自绘的好处是完全可控：形状、圆角、双色调、尺寸都能精确调。

- 统一 `viewBox="0 0 24 24"` + `fill="currentColor"`，
  颜色跟随按钮前景色，不要写死颜色。
- **必须归一化**。手绘路径的 bbox 天生不一致，直接内联会一大一小。
  做法：量出每个图标的 bbox，给每个包一个 `<g transform>` 把它
  缩放平移到「内容占框 64%、中心 (12,12)」。格式：
  `translate(tx ty) scale(k)`，tx/ty 由 bbox 反算。
- **上一首是下一首的镜像**：`translate(24 0) scale(-1 1)` 包一层，
  不用另画一套。翻的是图形不是功能，`onclick` 仍是 `handlePrev()`。
- 双色调靠透明度分层：齿轮体 `.55`、列表圆点 `.5`、单曲箭头 `.5`，
  主体实心。新增双色调图标照这个思路校准。
- **尺寸不要靠猜，靠量**。先在浏览器里量出实际墨迹像素
  （bbox × 盒子尺寸 / 24），再和「用户觉得合适」的版本对比。
  v10.2.18 的实测值可作基准：普通图标约 9.2~10.8px、播放三角约 20px。
  当前各档位：
  - 桌面 prev/next/mode/vol `16px`、齿轮 `18px`、播放键 `30px`
  - 移动 prev/next/mode/gear `26px`、播放键 `38px`
- 改完必须验三件事：bbox 中心是否在 (12,12)、
  prev/next 是否严格镜像（误差应 0%）、左右是否对称。
- 播放三角的不对称度约 39% 属正常（三角形本身如此），不是 bug。
- 圆角多边形别手写弧线控制点，用脚本按切线算；
  齿轮用圆弧齿（齿顶/齿根各一段同心圆弧），
  避免出现重合点导致 bbox 计算出错。

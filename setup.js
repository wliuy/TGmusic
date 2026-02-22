const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

/**
 * Sarah MUSIC 旗舰全功能重构版 9.2.5
 * 1. 无损重构：全量继承 8.9.9 的视觉厚度与交互算法，拒绝任何代码简化。
 * 2. D1 深度集成：使用 Cloudflare D1 关系型数据库，完美支撑千级歌曲管理。
 * 3. 独立排序：实现全库、收藏、自定义列表的排序位物理隔离。
 * 4. 协议合规：遵循《无损重构协议》，保持单文件构建及完整硬编码结构。
 */
const REMOTE_URL = 'git@github.com:wliuy/TGmusic.git';
const COMMIT_MSG = 'feat: Sarah MUSIC 9.2.5 (彻底修复FLAC播放，优化上传预览累加，统一UI图标)';
const files = {};

// --- API: 流媒体传输 (保持高效代理) ---
files['functions/api/stream.js'] = `export async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const fileId = url.searchParams.get('file_id');
  const BOT_TOKEN = env.TG_Bot_Token;
  if (!fileId || !BOT_TOKEN) return new Response("Params error", { status: 400 });
  try {
    const getFileUrl = "https://api.telegram.org/bot" + BOT_TOKEN + "/getFile?file_id=" + fileId;
    const fileInfo = await (await fetch(getFileUrl)).json();
    if (!fileInfo.ok) return new Response("TG API Fault", { status: 400 });
    const downloadUrl = "https://api.telegram.org/file/bot" + BOT_TOKEN + "/" + fileInfo.result.file_path;
    const range = request.headers.get('Range');
    const fileRes = await fetch(downloadUrl, { headers: range ? { 'Range': range } : {} });
    const headers = new Headers(fileRes.headers);
    headers.set('Access-Control-Allow-Origin', '*');
    headers.set('Cache-Control', 'public, max-age=31536000');
    if (!headers.has('Content-Type')) {
      const fp = fileInfo.result.file_path || "";
      headers.set('Content-Type', fp.toLowerCase().endsWith('.flac') ? 'audio/flac' : 'audio/mpeg');
    }
    return new Response(fileRes.body, { status: fileRes.status, headers });
  } catch (err) { return new Response("Service Error", { status: 500 }); }
}`;

// --- API: 列表获取 (D1 关系聚合) ---
files['functions/api/songs.js'] = `export async function onRequest(context) {
  const { env } = context;
  try {
    const songs = await env.DB.prepare("SELECT * FROM songs").all();
    const mappings = await env.DB.prepare("SELECT * FROM playlist_mapping ORDER BY sort_order DESC").all();
    const playlists = await env.DB.prepare("SELECT * FROM playlists WHERE id NOT IN ('all', 'fav')").all();
    
    const res = {
      songs: songs.results || [],
      favorites: mappings.results.filter(m => m.playlist_id === 'fav').map(m => m.file_id),
      playlists: playlists.results.map(p => ({
        id: p.id,
        name: p.name,
        ids: mappings.results.filter(m => m.playlist_id === p.id).map(m => m.file_id)
      })),
      all_order: mappings.results.filter(m => m.playlist_id === 'all').map(m => m.file_id)
    };
    return new Response(JSON.stringify(res), { headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' } });
  } catch (err) { 
    return new Response(JSON.stringify({ songs:[], favorites:[], playlists:[], all_order:[] }), { status: 200 }); 
  }
}`;

// --- API: 管理中心 (原子化 SQL 操作) ---
files['functions/api/manage.js'] = `export async function onRequest(context) {
  const { request, env } = context;
  if (request.method !== 'POST') return new Response("Bad Method", { status: 405 });
  try {
    const { action, data } = await request.json();
    if (action === 'update_song') {
      await env.DB.prepare("UPDATE songs SET title = ?1, artist = ?2 WHERE file_id = ?3").bind(data.title, data.artist, data.file_id).run();
    } else if (action === 'delete_song') {
      if (data.playlist_id === 'all') {
        await env.DB.prepare("DELETE FROM songs WHERE file_id = ?").bind(data.file_id).run();
        await env.DB.prepare("DELETE FROM playlist_mapping WHERE file_id = ?").bind(data.file_id).run();
      } else {
        await env.DB.prepare("DELETE FROM playlist_mapping WHERE playlist_id = ? AND file_id = ?").bind(data.playlist_id, data.file_id).run();
      }
    } else if (action === 'toggle_fav') {
      const exist = await env.DB.prepare("SELECT 1 FROM playlist_mapping WHERE playlist_id = 'fav' AND file_id = ?").bind(data.file_id).first();
      if (exist) await env.DB.prepare("DELETE FROM playlist_mapping WHERE playlist_id = 'fav' AND file_id = ?").bind(data.file_id).run();
      else await env.DB.prepare("INSERT INTO playlist_mapping (playlist_id, file_id, sort_order) VALUES ('fav', ?, ?)")
          .bind(data.file_id, Date.now()).run();
    } else if (action === 'add_playlist') {
      await env.DB.prepare("INSERT INTO playlists (id, name) VALUES (?, ?)").bind(crypto.randomUUID(), data.name).run();
    } else if (action === 'rename_playlist') {
      await env.DB.prepare("UPDATE playlists SET name = ? WHERE id = ?").bind(data.name, data.id).run();
    } else if (action === 'delete_playlist') {
      await env.DB.prepare("DELETE FROM playlists WHERE id = ?").bind(data.id).run();
      await env.DB.prepare("DELETE FROM playlist_mapping WHERE file_id = ?").bind(data.id).run();
    } else if (action === 'add_to_playlist') {
      await env.DB.prepare("INSERT OR IGNORE INTO playlist_mapping (playlist_id, file_id, sort_order) VALUES (?, ?, ?)")
        .bind(data.playlist_id, data.file_id, Date.now()).run();
    } else if (action === 'update_order') {
      const { playlist_id, ids } = data;
      const statements = ids.map((fid, idx) => 
        env.DB.prepare("INSERT INTO playlist_mapping (playlist_id, file_id, sort_order) VALUES (?1, ?2, ?3) ON CONFLICT(playlist_id, file_id) DO UPDATE SET sort_order = ?3")
          .bind(playlist_id, fid, ids.length - idx)
      );
      await env.DB.batch(statements);
    } else if (action === 'get_logs') {
      const logs = await env.DB.prepare("SELECT * FROM upload_logs ORDER BY timestamp DESC LIMIT 50").all();
      return new Response(JSON.stringify({ success: true, logs: logs.results || [] }));
    } else if (action === 'clear_logs') {
      await env.DB.prepare("DELETE FROM upload_logs").run();
    }
    return new Response(JSON.stringify({ success: true }));
  } catch (err) { return new Response(JSON.stringify({ success: false, error: err.message }), { status: 500 }); }
}`;

// --- API: 上传中心 (同步 D1 + 封面 URL 化) ---
files['functions/api/upload.js'] = `export async function onRequest(context) {
  const { request, env } = context;
  const BOT_TOKEN = env.TG_Bot_Token;
  const CHAT_ID = env.TG_Chat_ID;
  
  await env.DB.prepare("CREATE TABLE IF NOT EXISTS upload_logs (id INTEGER PRIMARY KEY AUTOINCREMENT, filename TEXT, status TEXT, reason TEXT, timestamp DATETIME DEFAULT CURRENT_TIMESTAMP)").run();

  let filename = "Unknown";
  try {
    const formData = await request.formData();
    const audioFile = formData.get('file');
    const coverFile = formData.get('cover');
    const targetPlaylist = formData.get('target_playlist');
    filename = audioFile.name || "Unknown";
    const meta = JSON.parse(formData.get('meta') || '{}');
    
    // 步骤 1: 处理封面上传 (若有)
    let finalCoverUrl = "";
    if (coverFile) {
      const imgFormData = new FormData();
      imgFormData.append('chat_id', CHAT_ID);
      imgFormData.append('photo', coverFile);
      const imgRes = await fetch("https://api.telegram.org/bot" + BOT_TOKEN + "/sendPhoto", { method: 'POST', body: imgFormData });
      const imgData = await imgRes.json();
      if (imgData.ok) {
        const photoArr = imgData.result.photo;
        const bestFid = photoArr[photoArr.length - 1].file_id;
        finalCoverUrl = "/api/stream?file_id=" + bestFid;
      }
    }

    // 步骤 2: 上传音频
    const tgFormData = new FormData();
    tgFormData.append('chat_id', CHAT_ID);
    tgFormData.append('audio', audioFile);
    const tgRes = await fetch("https://api.telegram.org/bot" + BOT_TOKEN + "/sendAudio", { method: 'POST', body: tgFormData });
    const result = await tgRes.json();
    
    if (!result.ok) {
      const errorMsg = result.description || "Telegram API Error";
      await env.DB.prepare("INSERT INTO upload_logs (filename, status, reason) VALUES (?, 'FAIL', ?)").bind(filename, errorMsg).run();
      return new Response(JSON.stringify({ success: false, error: errorMsg }), { status: 400 });
    }
    
    const fid = result.result.audio.file_id;
    await env.DB.prepare("INSERT INTO songs (file_id, title, artist, cover, lrc) VALUES (?1, ?2, ?3, ?4, ?5)")
      .bind(fid, meta.title || "未知", meta.artist || "未知", finalCoverUrl, meta.lrc || "").run();
    
    await env.DB.prepare("INSERT INTO playlist_mapping (playlist_id, file_id, sort_order) VALUES ('all', ?, ?)")
      .bind(fid, Date.now()).run();

    if (targetPlaylist) {
      await env.DB.prepare("INSERT OR IGNORE INTO playlist_mapping (playlist_id, file_id, sort_order) VALUES (?, ?, ?)")
        .bind(targetPlaylist, fid, Date.now()).run();
    }

    await env.DB.prepare("INSERT INTO upload_logs (filename, status, reason) VALUES (?, 'SUCCESS', 'OK')").bind(filename).run();
    return new Response(JSON.stringify({ success: true, file_id: fid }));
  } catch (err) { 
    await env.DB.prepare("INSERT INTO upload_logs (filename, status, reason) VALUES (?, 'FAIL', ?)").bind(filename, err.message).run();
    return new Response(JSON.stringify({ success: false, error: err.message }), { status: 500 }); 
  }
}`;

files['manifest.json'] = `{
  "name": "Sarah Music",
  "short_name": "Sarah",
  "description": "D1 High-Performance Cloud Music",
  "start_url": "/",
  "display": "standalone",
  "background_color": "#4d7c5f",
  "theme_color": "#4d7c5f",
  "orientation": "portrait",
  "icons": [
    { "src": "https://tc.yang.pp.ua/file/logo/sarah-y.png", "sizes": "512x512", "type": "image/png", "purpose": "any maskable" }
  ]
}`;

files['sw.js'] = `const CACHE_NAME = 'sarah-music-v925';
self.addEventListener('install', (e) => { self.skipWaiting(); e.waitUntil(caches.open(CACHE_NAME).then((c) => c.addAll(['/']))); });
self.addEventListener('activate', (e) => { e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))))); self.clients.claim(); });
self.addEventListener('fetch', (e) => { if (e.request.url.includes('/api/')) return; e.respondWith(caches.match(e.request).then((res) => res || fetch(e.request))); });`;

files['index.html'] = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no, viewport-fit=cover">
    <meta name="theme-color" content="#4d7c5f">
    <meta name="apple-mobile-web-app-capable" content="yes">
    <meta name="apple-mobile-web-app-status-bar-style" content="default">
    <meta name="apple-mobile-web-app-title" content="Sarah">
    <link rel="manifest" href="/manifest.json">
    <title>Sarah</title>
    <link rel="icon" href="https://tc.yang.pp.ua/file/logo/sarah-y.png">
    <script src="https://cdn.tailwindcss.com"></script>
    <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/aplayer/dist/APlayer.min.css">
    <link href="https://fonts.googleapis.com/css2?family=Noto+Sans+SC:wght@300;500;700;900&family=Playfair+Display:ital,wght@1,700&display=swap" rel="stylesheet">
    <script src="https://cdnjs.cloudflare.com/ajax/libs/jsmediatags/3.9.5/jsmediatags.min.js"></script>
    <style>
        :root {
            --dynamic-accent: #d97706; --solara-text: #1e293b; --glass-blur: blur(40px);
            --main-glass: linear-gradient(135deg, rgba(255, 255, 255, 0.15) 0%, rgba(255, 255, 255, 0.05) 100%);
            --inner-glass: rgba(255, 255, 255, 0.15); --glass-border: rgba(255, 255, 255, 0.25);
            --m-green: #4d7c5f; --btn-icon-color: #ffffff;
            --logo-url: url('https://tc.yang.pp.ua/file/logo/sarah(1).png');
        }

        body { color: var(--solara-text); font-family: 'Noto Sans SC', sans-serif; height: 100vh; margin: 0; overflow: hidden; background: #fdf2f2; transition: background 0.8s ease; }
        #bg-stage { position: fixed; inset: 0; z-index: -1; transition: background 1.5s cubic-bezier(0.4, 0, 0.2, 1); }

        .desktop-container { 
            width: 96%; max-width: 1350px; height: 82vh; 
            background: var(--main-glass); backdrop-filter: var(--glass-blur); -webkit-backdrop-filter: var(--glass-blur);
            border: 1px solid var(--glass-border); border-radius: 24px; 
            box-shadow: 0 40px 120px rgba(0, 0, 0, 0.1); 
            display: flex; flex-direction: column; padding: 24px 44px; gap: 16px; 
            position: absolute; left: 50%; top: 50%; transform: translate(-50%, -50%); 
            justify-content: space-between; transition: all 1.2s ease; 
        }

        .settings-corner { position: absolute; right: 32px; top: 25px; z-index: 200; display: flex; align-items: center; justify-content: center; }
        .brand-title { font-size: 3rem; font-weight: 900; color: white; text-align: center; }
        .brand-sub { font-size: 0.85rem; font-weight: 700; color: rgba(255,255,255,0.6); text-align: center; margin-top: 12px; font-style: italic; }

        .search-panel { background: rgba(255, 255, 255, 0.15); border-radius: 16px; border: 1px solid rgba(255, 255, 255, 0.2); padding: 20px 36px; display: flex; gap: 16px; align-items: center; }
        .search-capsule { flex: 1; height: 44px; background: rgba(255, 255, 255, 0.25); border-radius: 12px; display: flex; align-items: center; border: 1px solid rgba(255, 255, 255, 0.3); backdrop-filter: blur(15px); padding-right: 12px; }
        .search-input-field { flex: 1; background: transparent; border: 0; outline: none; padding: 0 16px; font-weight: 700; font-size: 1.15rem; color: #1e293b; }
        .search-confirm-btn { background: var(--dynamic-accent); color: white; padding: 0 32px; height: 44px; border-radius: 12px; font-weight: 900; box-shadow: 0 10px 25px rgba(0,0,0,0.15); transition: 0.3s; }
        .clear-search-icon { width: 24px; height: 24px; display: grid; place-items: center; opacity: 0.3; cursor: pointer; transition: 0.2s; color: #1e293b; }
        .clear-search-icon:hover { opacity: 0.8; }

        .content-layout { flex: 1; display: grid; grid-template-columns: 0.65fr 1fr 1fr; gap: 24px; overflow: hidden; max-height: 55%; margin: 10px 0; }
        .panel-box { background: var(--inner-glass); border-radius: 16px; border: 1px solid rgba(255, 255, 255, 0.2); display: flex; flex-direction: column; overflow: hidden; }
        
        .song-item { padding: 12px 16px; margin: 3px 8px; border-radius: 10px; display: flex; align-items: center; gap: 12px; cursor: pointer; transition: 0.2s; }
        .song-item.active { background: rgba(255, 255, 255, 0.3); color: var(--dynamic-accent); font-weight: 900; }
        .song-title-text { font-size: 13px !important; font-weight: 700; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .song-artist-text { font-size: 11px !important; opacity: 0.5; text-transform: uppercase; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }

        .lyrics-panel { flex: 1; height: 100%; width: 100%; mask-image: linear-gradient(to bottom, transparent, black 15%, black 85%, transparent); overflow-y: auto; scroll-behavior: smooth; text-align: center; display: flex; flex-direction: column; align-items: center; position: relative; background: transparent !important; padding-top: 45%; padding-bottom: 45%; }
        .lrc-line { display: block; width: 90%; padding: 10px 14px; font-size: 14px; font-weight: 600; color: #475569; transition: all 0.4s ease; flex-shrink: 0; opacity: 0.5; }
        .lrc-line.active { color: var(--dynamic-accent); background: rgba(255, 255, 255, 0.25); border-radius: 10px; font-weight: 900; opacity: 1; backdrop-filter: blur(10px); transform: scale(1.1); }

        .footer-bar { height: 90px; background: transparent; display: flex; align-items: center; padding: 0 10px; gap: 24px; margin-top: auto; }
        .btn-round { width: 44px; height: 44px; border-radius: 50%; background: var(--dynamic-accent); display: flex; align-items: center; justify-content: center; flex-shrink: 0; cursor: pointer; transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1); box-shadow: 0 10px 25px rgba(0,0,0,0.15); color: var(--btn-icon-color); border: 0 !important; overflow: hidden; }
        @media (hover: hover) { .btn-round:hover { transform: translateY(-3px); } }
        .btn-main { width: 56px !important; height: 56px !important; }

        .scrubber-area { flex: 1; display: flex; align-items: center; gap: 16px; margin: 0 20px; }
        .rail { flex: 1; height: 6px; background: rgba(0, 0, 0, 0.08); border-radius: 10px; position: relative; cursor: pointer; }
        .fill { height: 100%; background: var(--dynamic-accent); border-radius: 10px; width: 0%; position: relative; }
        .dot { position: absolute; right: -7px; top: 50%; transform: translateY(-50%); width: 14px; height: 14px; background: white; border-radius: 50%; border: 2px solid var(--dynamic-accent); box-shadow: 0 2px 6px rgba(0,0,0,0.1); cursor: grab; }
        
        .volume-control { width: 150px; display: flex; align-items: center; gap: 12px; }
        .volume-rail { flex: 1; height: 4px; background: rgba(0, 0, 0, 0.08); border-radius: 10px; position: relative; cursor: pointer; }

        .cover-container { 
            width: 14rem; height: 14rem; border-radius: 1.5rem; overflow: hidden; margin-bottom: 2rem; 
            box-shadow: 0 15px 45px rgba(0,0,0,0.1); border: 1px solid rgba(255,255,255,0.2); 
            display: flex; align-items: center; justify-content: center; position: relative; 
            background: rgba(255,255,255,0.08); backdrop-filter: blur(30px);
        }
        .cover-img { width: 100%; height: 100%; object-fit: cover; transition: 0.8s cubic-bezier(0.4, 0, 0.2, 1); z-index: 10; position: absolute; inset: 0; }
        .cover-placeholder { position: absolute; inset: 0; z-index: 5; display: flex; align-items: center; justify-content: center; flex-direction: column; overflow: hidden; background: var(--logo-url); background-size: cover; background-position: center; }

        .mobile-player-container { display: none; position: fixed; inset: 0; z-index: 100; flex-direction: column; padding: env(safe-area-inset-top) 20px env(safe-area-inset-bottom) 10px; background: var(--m-green); }
        .m-header { height: 50px; width: 100%; display: flex; align-items: center; justify-content: space-between; flex-shrink: 0; background: transparent; border: 0; }
        .m-header .btn-round { background: transparent !important; border: 0 !important; box-shadow: none !important; width: 44px; height: 44px; color: white !important; z-index: 210; }

        .m-main { flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; overflow: visible !important; width: 100%; padding: 0px 0; }
        .m-controls-capsule { background: transparent; border: 0; padding: 0 15px 45px 15px; width: 100%; flex-shrink: 0; }
        #m-scrubber-wrap { position: relative; height: 32px; display: flex; align-items: center; cursor: pointer; touch-action: none; margin-bottom: -4px; z-index: 10; }
        #m-scrubber-wrap .rail { width: 100%; height: 4px; border-radius: 10px; }

        @keyframes disc-rotate { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
        .m-disc-container { width: 72vw; max-width: 280px; aspect-ratio: 1/1; position: relative; flex-shrink: 0; background: transparent !important; border-radius: 50% !important; isolation: isolate; margin: 0px 0; }
        .m-disc-shadow-layer { position: absolute; inset: -45px; border-radius: 50%; background: radial-gradient(circle at center, rgba(0,0,0,0.5) 0%, rgba(0,0,0,0.15) 45%, transparent 72%); z-index: 0; pointer-events: none; }
        .m-disc-clipping { position: absolute; inset: 0; width: 100%; height: 100%; border-radius: 50% !important; overflow: hidden !important; border: 6px solid rgba(255,255,255,0.12); clip-path: circle(50% at 50% 50%); -webkit-mask-image: -webkit-radial-gradient(white, black); z-index: 5; animation: disc-rotate 25s linear infinite; animation-play-state: paused; }
        .m-disc-container.playing .m-disc-clipping { animation-play-state: running; }
        .m-disc-clipping img { width: 100%; height: 100%; object-fit: cover; border-radius: 50% !important; }

        .m-lyrics-panel { height: 120px; width: 100%; position: relative; display: flex; flex-direction: column; align-items: center; overflow-y: auto; scroll-behavior: smooth; mask-image: linear-gradient(to bottom, transparent 0%, black 25%, black 75%, transparent 100%); -webkit-mask-image: linear-gradient(to bottom, transparent 0%, black 25%, black 75%, transparent 100%); pointer-events: none; background: transparent !important; flex-shrink: 0; margin-bottom: 0px; margin-top: 10px; }
        .m-lyrics-panel::-webkit-scrollbar { display: none; }
        .m-lyrics-panel .lrc-line { background: transparent !important; text-align: center; color: white; opacity: 0.3; transition: all 0.5s cubic-bezier(0.4, 0, 0.2, 1); border: 0 !important; padding: 6px 10px; font-size: 14px; width: 90%; transform: scale(0.95); flex-shrink: 0; transform-origin: center; }
        .m-lyrics-panel .lrc-line.active { display: block !important; font-size: 1.15rem; opacity: 1; font-weight: 900; transform: scale(1.08); color: white; text-shadow: 0 0 20px rgba(255,255,255,0.3); }

        .m-info-wrap { width: 100%; text-align: center; color: white; flex-shrink: 0; margin-top: 15px; margin-bottom: -2px; }
        .m-song-title { font-size: 1.25rem; font-weight: 900; letter-spacing: 0.05em; margin-bottom: 0px; }
        .m-artist-row { display: flex; align-items: center; justify-content: center; gap: 8px; opacity: 0.6; font-size: 0.75rem; font-weight: 800; letter-spacing: 0.1em; }
        
        .m-controls { width: 100%; flex-shrink: 0; }
        .m-time-row { display: flex; justify-content: space-between; width: 100%; padding: 8px 2px 0 2px; margin-top: -4px; }
        .m-time-text { font-size: 10px; font-weight: 900; opacity: 0.5; color: white; }
        
        .m-btn-row { display: flex; align-items: center; justify-content: space-between; width: 100%; padding-top: 15px; }
        .m-btn-row .btn-round { width: 50px; height: 50px; background: white !important; color: var(--m-green) !important; box-shadow: 0 10px 30px rgba(0,0,0,0.1); border: 0 !important; display: grid; place-items: center; flex-shrink: 0; }
        .m-btn-row .btn-main { width: 68px !important; height: 68px !important; }

        #m-overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.45); backdrop-filter: blur(10px); -webkit-backdrop-filter: blur(10px); z-index: 999; display: none; }
        .m-drawer { position: fixed; bottom: -100%; left: 0; width: 100%; height: 80vh; background: #4d7c5f; backdrop-filter: blur(40px); -webkit-backdrop-filter: blur(40px); z-index: 1000; border-radius: 32px 32px 0 0; transition: 0.45s cubic-bezier(0.19, 1, 0.22, 1); display: flex; flex-direction: column; overflow: hidden; border: 1px solid rgba(255,255,255,0.08); }
        .m-drawer.active { bottom: 0; }
        
        #m-pl-cards { display: flex; gap: 0px; overflow-x: auto; padding: 15px 20px 0 20px; flex-shrink: 0; border-bottom: 1.5px solid rgba(255,255,255,0.1); }
        #m-pl-cards::-webkit-scrollbar { display: none; }
        .m-pl-card { 
            flex-shrink: 0; height: 38px; min-width: 80px; padding: 0 18px; border-radius: 12px 12px 0 0; background: rgba(255,255,255,0.04); 
            border: 1px solid rgba(255,255,255,0.1); border-bottom: none; display: flex; align-items: center; 
            justify-content: center; margin-right: 4px; transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
        }
        .m-pl-card.active { background: white !important; color: #1e293b !important; border-color: white !important; transform: translateY(1.5px); z-index: 10; font-weight: 900; }
        .m-pl-card-name { font-size: 11px; font-weight: 700; letter-spacing: 0.05em; text-align: center; white-space: nowrap; }

        .m-list-search-wrap { padding: 12px 20px 10px 20px; flex-shrink: 0; display: flex; align-items: center; position: relative; }
        .m-list-search-box { width: 100%; height: 46px; background: rgba(255,255,255,0.08); border: 1.5 solid rgba(255,255,255,0.15); border-radius: 16px; padding: 0 45px 0 20px; color: white; font-size: 14px; font-weight: 700; outline: none; }
        .m-clear-search { position: absolute; right: 35px; color: white; opacity: 0.5; cursor: pointer; }

        .modal { display: none; position: fixed; inset: 0; background: rgba(0,0,0,0.4); backdrop-filter: blur(20px); z-index: 2000; align-items: center; justify-content: center; }
        .modal.active { display: flex; }
        .sarah-dialog-overlay.active { display: flex !important; }
        
        #admin-box { width: 92%; max-width: 900px; height: 85vh; background: rgba(255, 255, 255, 0.08); backdrop-filter: blur(60px); border-radius: 28px; border: 1px solid rgba(255,255,255,0.1); display: flex; flex-direction: column; overflow: hidden; box-shadow: 0 50px 100px rgba(0,0,0,0.3); outline: none !important; }
        .admin-header { padding: 15px 30px; border-bottom: 1px solid rgba(255,255,255,0.05); display: flex; justify-content: space-between; align-items: center; flex-shrink: 0; min-height: 90px; }
        .admin-action-bar { display: flex; align-items: center; gap: 12px; flex-shrink: 0; }
        .admin-btn-icon { width: 46px; height: 46px; display: grid; place-items: center; background: rgba(255,255,255,0.2); border-radius: 16px; border: 1.5px solid rgba(255,255,255,0.3); transition: 0.3s; cursor: pointer; color: white; backdrop-filter: brightness(1.2); }
        .admin-btn-icon:hover { background: rgba(255,255,255,0.4); transform: scale(1.05); }
        .admin-btn-icon:active { transform: scale(0.95); }

        #admin-header-center { flex: 1; display: flex; justify-content: center; align-items: center; overflow: hidden; padding: 0 20px; }
        .admin-console-box { background: rgba(255, 255, 255, 0.05); border-radius: 18px; border: 1px solid rgba(255,255,255,0.1); padding: 8px 20px; width: auto; max-width: 100%; }

        .admin-content { flex: 1; overflow-y: auto; padding: 30px; }
        
        .admin-tabs-nav { display: flex; align-items: flex-end; gap: 4px; overflow-x: auto; margin-bottom: 15px; padding: 0 5px; }
        .admin-tabs-nav::-webkit-scrollbar { display: none; }
        .browser-tab {
            min-width: 70px; max-width: 140px; height: 36px; padding: 0 10px;
            background: rgba(255, 255, 255, 0.05); border-radius: 10px 10px 0 0;
            display: flex; align-items: center; justify-content: center; cursor: pointer;
            border: 1px solid rgba(255, 255, 255, 0.1); border-bottom: none;
            transition: all 0.2s; position: relative; flex-shrink: 0;
        }
        .browser-tab.active { background: rgba(255, 255, 255, 0.15); border-color: rgba(255, 255, 255, 0.2); z-index: 10; }
        .browser-tab.active .browser-tab-text { opacity: 1; color: #10b981; }
        .browser-tab-text { font-size: 11px; font-weight: 900; color: white; opacity: 0.6; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; text-align: center; }
        .browser-tab-close { position: absolute; top: 1px; right: 1px; width: 14px; height: 14px; border-radius: 4px; display: grid; place-items: center; opacity: 0.8; transition: 0.2s; color: white; flex-shrink: 0; background: rgba(255, 255, 255, 0.08); }
        .browser-tab-close:hover { opacity: 1 !important; background: rgba(255,255,255,0.2); }
        .browser-tab-add { width: 32px; height: 32px; border-radius: 50%; display: flex; align-items: center; justify-content: center; background: rgba(255, 255, 255, 0.08); color: white; cursor: pointer; flex: none; flex-shrink: 0; margin-left: 10px; transition: 0.2s; aspect-ratio: 1/1; overflow: hidden; }
        .browser-tab-add:hover { background: rgba(255, 255, 255, 0.15); transform: scale(1.1); }

        .admin-song-row {
            display: flex; align-items: center; gap: 12px; padding: 12px 16px;
            background: rgba(255, 255, 255, 0.05); border-radius: 14px; border: 1px solid rgba(255, 255, 255, 0.1);
            margin-bottom: 8px; transition: transform 0.2s cubic-bezier(0.2, 0.8, 0.2, 1); position: relative; will-change: transform;
            cursor: grab;
            -webkit-touch-callout: none !important; -webkit-user-select: none !important; user-select: none !important; touch-action: pan-y;
        }
        .admin-song-row:hover { background: rgba(255, 255, 255, 0.1); }
        .admin-song-row.is-dragging { 
            position: fixed !important; pointer-events: none !important; opacity: 0.85 !important; 
            border: 2px solid var(--dynamic-accent) !important; background: rgba(0,0,0,0.7) !important; 
            z-index: 10000 !important; box-shadow: 0 40px 80px rgba(0,0,0,0.6) !important; 
            transition: none !important; transform: scale(1.03); 
        }
        .admin-song-placeholder { height: 64px; border: 2px dashed rgba(255, 255, 255, 0.25); border-radius: 14px; margin-bottom: 8px; background: rgba(255, 255, 255, 0.03); transition: none; }
        .admin-song-row.is-hidden { visibility: hidden !important; height: 0 !important; margin: 0 !important; padding: 0 !important; border: 0 !important; overflow: hidden; }
        .admin-song-info { flex: 1; display: flex; flex-direction: column; gap: 2px; min-width: 0; pointer-events: none; }
        .admin-song-input { background: transparent; border: none; outline: none; color: white; font-weight: 700; width: 100%; padding: 2px 6px; border-radius: 6px; transition: 0.2s; cursor: inherit; }
        .admin-song-title-input { font-size: 14px; }
        .admin-song-artist-input { font-size: 11px; opacity: 0.5; }
        .admin-song-row.editing { cursor: default; }
        .admin-song-row.editing .admin-song-info { pointer-events: auto; }
        .admin-song-row.editing .admin-song-input { background: rgba(0,0,0,0.3); border: 1px solid rgba(255,255,255,0.2); cursor: text; }
        .admin-action-group { display: flex; align-items: center; gap: 6px; }
        .admin-action-btn { width: 32px; height: 32px; border-radius: 10px; display: grid; place-items: center; background: rgba(255, 255, 255, 0.1); color: white; transition: 0.2s; cursor: pointer; }
        .admin-action-btn:hover { background: var(--dynamic-accent); transform: scale(1.05); }
        .admin-action-btn.delete:hover { background: #ef4444; }

        .upload-preview-item { display: flex; flex-direction: column; gap: 8px; padding: 12px 14px; background: rgba(255, 255, 255, 0.05); border-radius: 18px; border: 1px solid rgba(255, 255, 255, 0.1); animation: slideIn 0.3s ease-out; }
        @keyframes slideIn { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: translateY(0); } }
        .preview-main-row { display: flex; align-items: center; gap: 12px; width: 100%; }
        .preview-prog-container { width: 100%; height: 4px; background: rgba(255, 255, 255, 0.08); border-radius: 10px; overflow: hidden; }
        .preview-prog-fill { height: 100%; background: #10b981; width: 0%; transition: width 0.2s ease; }
        .preview-percent-text { font-size: 10px; font-weight: 900; color: #10b981; opacity: 0; transition: 0.3s; }
        .preview-status-dot { width: 8px; height: 8px; border-radius: 50%; background: #94a3b8; flex-shrink: 0; }
        .preview-status-dot.uploading { background: #10b981; box-shadow: 0 0 10px #10b981; animation: pulse 1.5s infinite; }
        .preview-status-dot.success { background: #10b981; }
        .preview-status-dot.error { background: #ef4444; }
        @keyframes pulse { 0% { opacity: 0.4; } 50% { opacity: 1; } 100% { opacity: 0.4; } }

        .upload-card { position: relative; padding: 12px 25px !important; background: rgba(255, 255, 255, 0.04); border: 2px dashed rgba(255, 255, 255, 0.2); border-radius: 18px; text-align: center; transition: 0.4s; cursor: pointer; overflow: hidden; display: flex; align-items: center; gap: 15px; }
        .upload-card:hover { border-color: var(--dynamic-accent); background: rgba(255, 255, 255, 0.1); }
        .upload-hint { display: flex; align-items: center; gap: 12px; cursor: pointer; width: 100%; }
        .upload-hint svg { opacity: 0.85; color: #10b981; width: 28px; height: 28px; }
        .upload-hint span { font-size: 11px; font-weight: 900; color: white; opacity: 0.9; text-transform: uppercase; letter-spacing: 1px; }

        @media (max-width: 768px) { 
            #admin-box { width: 90% !important; max-width: 440px; background: #4d7c5f !important; border-radius: 30px; height: 85vh; } 
            .admin-header { padding: 18px 20px; flex-direction: column; gap: 10px; height: auto; }
            #admin-header-center { width: 100%; padding: 0; }
            .browser-tab { min-width: 60px; max-width: 100px; padding: 0 8px; }
        }

        #msg-box { position: fixed; top: 30px; left: 50%; transform: translateX(-50%) translateY(-100px); background: var(--dynamic-accent); color: white; padding: 15px 50px; border-radius: 100px; font-weight: 900; z-index: 5000; transition: 0.5s; box-shadow: 0 15px 40px rgba(0, 0, 0, 0.1); }
        #msg-box.active { transform: translateX(-50%) translateY(0); }
        .custom-scroll::-webkit-scrollbar { width: 5px; }
        .custom-scroll::-webkit-scrollbar-thumb { background: rgba(255, 255, 255, 0.1); border-radius: 10px; }

        @media (max-width: 768px) { .desktop-container { display: none; } .mobile-player-container { display: flex; } }
    </style>
</head>
<body>
    <div id="msg-box"></div>
    <div id="bg-stage"></div>

    <div id="sarah-dialog" class="sarah-dialog-overlay fixed inset-0 bg-black/60 backdrop-blur-xl z-[3000] hidden items-center justify-center" onclick="closeSarahDialog()">
        <div class="sarah-dialog-box w-[320px] bg-[#1e293b] border border-white/10 rounded-3xl p-6 shadow-2xl" onclick="event.stopPropagation()">
            <h4 id="dialog-title" class="text-white font-black text-sm mb-4 uppercase tracking-widest text-center">提示</h4>
            <div id="dialog-input-wrap" class="hidden mb-4"><input id="dialog-input" class="w-full bg-white/10 p-3 rounded-xl text-white text-xs outline-none border border-white/10" placeholder="..."></div>
            <p id="dialog-msg" class="text-white/70 text-xs mb-6 text-center leading-relaxed px-2"></p>
            <div class="flex gap-2">
                <button id="dialog-cancel" onclick="closeSarahDialog()" class="flex-1 py-3 bg-white/5 text-white rounded-xl text-[10px] font-black">取消</button>
                <button id="dialog-confirm" class="flex-1 py-3 bg-[#4d7c5f] text-white rounded-xl text-[10px] font-black shadow-lg">确认</button>
            </div>
        </div>
    </div>

    <div id="playlist-selector-modal" class="fixed inset-0 bg-black/60 backdrop-blur-xl z-[3000] hidden items-center justify-center" onclick="closePlaylistSelector()">
        <div class="playlist-select-box w-[300px] bg-[#1e293b]/80 backdrop-blur-3xl border border-white/10 rounded-3xl p-6 shadow-2xl" onclick="event.stopPropagation()">
            <h4 class="text-white font-black text-sm mb-5 uppercase tracking-widest text-center">分发至歌单</h4>
            <div id="playlist-selector-list" class="space-y-3 max-h-[350px] overflow-y-auto custom-scroll"></div>
            <button onclick="closePlaylistSelector()" class="w-full mt-6 py-3 bg-white/10 text-white rounded-xl text-xs font-black">取消分发</button>
        </div>
    </div>

    <div class="desktop-container" id="main-ui">
        <header class="header-stack">
            <h1 class="brand-title">Sarah</h1>
            <p class="brand-sub">Premium Music Hub | v9.2.5</p>
            <div class="settings-corner">
                <div onclick="toggleAdmin(true)" class="btn-round !bg-white/10 border border-white/25 !shadow-xl hover:scale-110 cursor-pointer" id="pc-settings-trigger">
                    <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2.5"><path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/></svg>
                </div>
            </div>
        </header>
        <div class="search-panel">
            <div class="search-capsule">
                <input type="text" id="search-input" oninput="handleSearch()" placeholder="搜索列表内旋律..." class="search-input-field">
                <div id="pc-clear-search" class="clear-search-icon" onclick="clearSearch('search-input')"><svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="3"><path d="M6 18L18 6M6 6l12 12"></path></svg></div>
            </div>
            <button id="pc-search-btn" class="search-confirm-btn" onclick="handleSearch()">搜索</button>
        </div>
        <main class="content-layout">
            <section class="panel-box p-6 items-center text-center">
                <div class="cover-container shadow-sm border border-white/20 mx-auto" id="pc-cover-wrap"><div class="cover-placeholder rounded-2xl" id="pc-logo-box"></div><img id="ui-cover" src="" class="cover-img rounded-2xl" style="display:none"></div>
                <div class="mt-6 flex flex-col items-center w-full">
                    <h2 id="ui-title" class="text-base font-black text-slate-800 truncate w-full mb-1">歌曲标题</h2>
                    <p id="ui-artist" class="text-[11px] font-black opacity-40 uppercase truncate w-full"></p>
                    <button onclick="handleLikeToggle()" id="fav-trigger" class="mt-3 transition hover:scale-125 opacity-50 hover:opacity-100"><svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2.5"><path d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z"></path></svg></button>
                </div>
            </section>
            <section class="panel-box flex flex-col overflow-hidden">
                <div id="tabs-scroll" class="p-3 border-b border-black/5 flex gap-4 overflow-x-auto whitespace-nowrap no-scrollbar">
                    <div id="tab-play" onclick="switchList('all')" class="cursor-pointer active px-3 py-2 rounded-lg font-black text-xs">全库</div>
                    <div id="tab-fav" onclick="switchList('fav')" class="cursor-pointer px-3 py-2 rounded-lg font-black text-xs">收藏</div>
                    <div id="custom-tabs" class="inline-flex gap-4"></div>
                </div>
                <div id="list-view" class="flex-1 overflow-y-auto px-1 pb-3 custom-scroll"></div>
            </section>
            <section class="panel-box"><div id="lrc-view" class="lyrics-panel custom-scroll"></div></section>
        </main>
        <footer class="footer-bar">
            <div class="flex items-center gap-2">
                <div id="mode-btn" onclick="toggleMode()" class="btn-round"><svg id="mode-icon" class="w-5 h-5" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24"></svg></div>
                <div id="prev-btn" onclick="handlePrev()" class="btn-round"><svg class="w-4 h-4" fill="currentColor" viewBox="0 0 24 24"><path d="M6 6h3v12H6V6zm4.5 6l8.5 6V6l-8.5 6z"/></svg></div>
                <div id="play-btn" onclick="handlePlayToggle()" class="btn-round btn-main"><svg id="p-icon" class="w-8 h-8" fill="currentColor" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24"><path d="M8 5v14l11-7z"></path></svg></div>
                <div id="next-btn" onclick="handleNext()" class="btn-round"><svg class="w-4 h-4" fill="currentColor" viewBox="0 0 24 24"><path d="M6 18l8.5-6L6 6v12zM15 6v12h3V6h-3z"/></svg></div>
            </div>
            <div class="scrubber-area">
                <span id="cur-time" class="font-bold opacity-30 text-xs">00:00</span>
                <div id="pc-scrubber" class="rail" onmousedown="handleMouseSeekStart(event)"><div class="fill" id="prog-bar"><div class="dot" id="prog-dot"></div></div></div>
                <span id="total-time" class="font-bold opacity-30 text-xs">00:00</span>
            </div>
            <div class="volume-control">
                <div id="vol-trigger" onclick="toggleMute()" class="opacity-40 cursor-pointer"><svg id="v-icon" class="w-5 h-5" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24"></svg></div>
                <div id="pc-vol-rail" class="volume-rail" onmousedown="handleMouseVolStart(event)"><div class="fill" id="vol-bar" style="width: 70%"><div class="dot !w-3 !h-3 !-right-1.5" id="vol-dot"></div></div></div>
            </div>
        </footer>
    </div>

    <div id="m-player" class="mobile-player-container">
        <header class="m-header">
            <div onclick="toggleMobileDrawer(true)" class="btn-round !bg-transparent"><svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="4.2"><path d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"></path></svg></div>
            <h1 class="text-xl font-black text-white">Sarah</h1>
            <div onclick="toggleAdmin(true)" class="btn-round !bg-transparent"><svg class="w-7 h-7" fill="none" stroke="white" viewBox="0 0 24 24" stroke-width="2.5"><path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/></svg></div>
        </header>
        <main class="m-main">
            <div class="m-disc-container" id="m-disc-wrapper" onclick="handlePlayToggle()"><div class="m-disc-shadow-layer"></div><div class="m-disc-clipping" id="m-clipping-node"><div class="cover-placeholder !opacity-100" id="m-logo-box"></div><img id="m-ui-cover" src="" style="display:none;width:100%;height:100%;object-fit:cover"></div></div>
            <div id="m-lrc-flow" class="m-lyrics-panel"></div>
            <div class="m-info-wrap"><h2 id="m-ui-title" class="m-song-title truncate max-w-[90%] mx-auto"></h2><div class="m-artist-row"><span id="m-ui-artist" class="truncate max-w-[70%]"></span><button onclick="handleLikeToggle()" id="m-fav-trigger" class="ml-2"><svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2.5"><path d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z"></path></svg></button></div></div>
        </main>
        <footer class="m-controls-capsule">
            <div class="m-controls">
                <div class="w-full">
                    <div id="m-scrubber-wrap" ontouchstart="handleTouchStart(event)" ontouchmove="handleTouchMove(event)" ontouchend="handleTouchEnd(event)"><div id="m-scrubber" class="rail !bg-white/10"><div class="fill !bg-white" id="m-prog-bar"><div class="dot !right-[-7px] !w-[14px] !h-[14px] !border-[2px] !border-white !bg-[#4d7c5f]"></div></div></div></div>
                    <div class="m-time-row"><span id="m-cur-time" class="m-time-text">00:00</span><span id="m-total-time" class="m-time-text">00:00</span></div>
                </div>
                <div class="m-btn-row">
                    <div id="m-mode-btn" onclick="toggleMode()" class="btn-round !bg-white !text-[#4d7c5f]"><svg id="m-mode-icon" class="w-6 h-6" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24"></svg></div>
                    <div onclick="handlePrev()" class="btn-round !bg-white !text-[#4d7c5f]"><svg class="w-6 h-6" fill="currentColor" viewBox="0 0 24 24"><path d="M6 6h3v12H6V6zm4.5 6l8.5 6V6l-8.5 6z"/></svg></div>
                    <div onclick="handlePlayToggle()" class="btn-round btn-main !bg-white !text-[#4d7c5f]"><svg id="m-p-icon" class="w-10 h-10" fill="currentColor" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24"><path d="M8 5v14l11-7z"></path></svg></div>
                    <div onclick="handleNext()" class="btn-round !bg-white !text-[#4d7c5f]"><svg class="w-6 h-6" fill="currentColor" viewBox="0 0 24 24"><path d="M6 18l8.5-6L6 6v12zM15 6v12h3V6h-3z"/></svg></div>
                    <div onclick="toggleMobileDrawer(true)" class="btn-round !bg-white !text-[#4d7c5f]"><svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="4.2"><path d="M4 6h16M4 12h16M4 18h16"></path></svg></div>
                </div>
            </div>
        </footer>
    </div>

    <div id="m-overlay" onclick="toggleMobileDrawer(false); toggleAdmin(false)"></div>
    <div id="m-drawer" class="m-drawer">
        <div id="m-pl-cards" class="no-scrollbar"></div>
        <div class="m-list-search-wrap">
            <input type="text" id="m-list-search" class="m-list-search-box" placeholder="搜索列表内旋律..." oninput="handleSearch()">
            <div onclick="clearSearch('m-list-search')" class="m-clear-search"><svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="4"><path d="M6 18L18 6M6 6l12 12"></path></svg></div>
        </div>
        <div id="m-list-view" class="flex-1 overflow-y-auto custom-scroll text-white px-4 pb-10"></div>
    </div>

    <div id="admin-panel" class="modal">
        <div id="admin-box">
            <div class="admin-header">
                <div class="flex items-center gap-3 flex-shrink-0">
                    <h3 class="text-xl font-black text-white">设置</h3>
                    <span class="text-[10px] font-black text-white/40 bg-white/5 px-2 py-0.5 rounded tracking-wider">v9.2.5</span>
                </div>
                <div id="admin-header-center">
                    <div id="sleep-area" class="hidden"><div class="admin-console-box flex items-center gap-4"><span class="text-[9px] font-black text-white/30 uppercase tracking-widest whitespace-nowrap">定时</span><div class="flex gap-1.5"><button onclick="setSleep(15)" class="bg-white/10 px-3 py-1.5 rounded-lg text-[11px] font-bold">15</button><button onclick="setSleep(30)" class="bg-white/10 px-3 py-1.5 rounded-lg text-[11px] font-bold">30</button><button onclick="setSleep(60)" class="bg-white/10 px-3 py-1.5 rounded-lg text-[11px] font-bold">60</button><button onclick="setSleep(0)" class="bg-red-500/20 px-3 py-1.5 rounded-lg text-[11px] font-bold text-red-300">取消</button></div><span id="sleep-status" class="text-[10px] text-emerald-400 font-black tabular-nums"></span></div></div>
                    <div id="upload-area" class="hidden"><div class="admin-console-box flex items-center gap-4"><input type="file" id="f-in" multiple onchange="previewTag(this)" style="display:none"><label for="f-in" class="upload-card"><div class="upload-hint"><svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-width="2.2" d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12"></path></svg><span id="file-count-tip">点击/拖拽同步</span></div></label><button onclick="switchAdminList('logs')" class="bg-white/15 text-white px-5 py-2.5 rounded-xl font-black text-[11px] hover:bg-white/20 transition-all">上传日志</button></div></div>
                </div>
                <div class="admin-action-bar">
                    <button onclick="toggleSleepArea()" class="admin-btn-icon"><svg class="w-6 h-6" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg></button>
                    <button onclick="toggleUploadArea()" class="admin-btn-icon"><svg class="w-6 h-6" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12"></path></svg></button>
                    <button onclick="toggleAdmin(false)" class="admin-btn-icon !bg-white/10"><svg class="w-6 h-6" fill="none" stroke="currentColor" stroke-width="3"><path d="M6 18L18 6M6 6l12 12"></path></svg></button>
                </div>
            </div>
            <div class="admin-content custom-scroll">
                <div id="upload-preview-list" class="space-y-2 mb-6"></div>
                <div class="flex items-center mb-4"><div id="admin-playlist-tabs" class="admin-tabs-nav flex-1"></div></div>
                <div id="admin-song-list" class="space-y-2 mb-8 relative min-h-[100px]"></div>
            </div>
        </div>
    </div>

    <div id="ap-hidden" style="display:none"></div>
    <script src="https://cdn.jsdelivr.net/npm/aplayer/dist/APlayer.min.js"></script>
    <script>
        let ap = null, db = [], lrcLines = [], currentTab = 'all', tempMetaMap = new Map();
        let modeIdx = 0, dbIndexMap = new Map(), lastVolume = 0.7, isMuted = false, currentAdminTab = 'all';
        let currentThemeIdx = -1, sleepEndTime = null, sleepTimerInt = null, isScrubbing = false, isDraggingVol = false;
        let lastActiveFileId = null, longPressTimer = null, initialTouchY = 0, currentDraggedEl = null, dragPlaceholder = null, touchOffsetTop = 0; 
        let libState = { songs: [], favorites: [], playlists: [], all_order: [] };
        const modes = ['list', 'single', 'random'], DEFAULT_LOGO = 'https://tc.yang.pp.ua/file/logo/sarah(1).png';
        const solaraTheme = [
            { bg: '#f2c9b1', accent: '#e67e51', deep: '#c06c3e' }, { bg: '#c7f9cc', accent: '#2d6a4f', deep: '#1b4332' }, 
            { bg: '#f4acb7', accent: '#9d0208', deep: '#641212' }, { bg: '#a2d2ff', accent: '#0077b6', deep: '#1e3a8a' }, 
            { bg: '#ede0d4', accent: '#7f5539', deep: '#4b3832' }, { bg: '#cdb4db', accent: '#5e548e', deep: '#2e1065' }, 
            { bg: '#ffc8dd', accent: '#ec407a', deep: '#f5b8cf' }, { bg: '#e9d8a6', accent: '#9b2226', deep: '#7b241c' }, 
            { bg: '#f8fafc', accent: '#0ea5e9', deep: '#0c4a6e' }, { bg: '#1e293b', accent: '#f59e0b', deep: '#451a03' }, 
            { bg: '#f5f3ff', accent: '#8b5cf6', deep: '#2e1065' }, { bg: '#f0fdf4', accent: '#10b981', deep: '#064e3b' }, 
            { bg: '#fff1f2', accent: '#fb7185', deep: '#881337' }, { bg: '#f1f5f9', accent: '#64748b', deep: '#0f172a' }
        ];

        // 原子化指令下发 D1
        async function dbOp(action, data = {}) {
            try {
                const res = await fetch('/api/manage', { method: 'POST', body: JSON.stringify({ action, data }) });
                const result = await res.json();
                if (!result.success) console.error("D1 Action Error:", result.error);
                return result;
            } catch (e) { console.error(e); return { success: false }; }
        }

        async function init() {
            if ('serviceWorker' in navigator) {
                navigator.serviceWorker.register('/sw.js').then(reg => {
                    reg.addEventListener('updatefound', () => {
                        const newWorker = reg.installing;
                        newWorker.addEventListener('statechange', () => {
                            if (newWorker.state === 'installed' && navigator.serviceWorker.controller) { /* 取消强制刷新 */ }
                        });
                    });
                }).catch(() => {});
            }
            try {
                const res = await fetch('/api/songs'); const raw = await res.json();
                if (raw.error) { console.error("D1 Loader Error"); return; }
                libState = raw; db = libState.songs;
                buildIndexMap(); renderCustomTabs(); renderAllLists(); setupPlayer(); updateUIModes(); updateVolUI(lastVolume); 
                window.addEventListener('keydown', (e) => { if (e.code === 'Space') { const activeEl = document.activeElement; if (activeEl.tagName !== 'INPUT' && activeEl.tagName !== 'TEXTAREA') { e.preventDefault(); handlePlayToggle(); } } });
                updateBackground(true); 
                if (libState.all_order.length > 0) refreshUIMetaAt(dbIndexMap.get(libState.all_order[0]));
                else if (db.length > 0) refreshUIMetaAt(0);
                const savedVol = localStorage.getItem('sarah-vol');
                if(ap) { ap.volume(parseFloat(savedVol || 0.7), true); updateVolUI(ap.audio.volume); }
            } catch (e) { console.error(e); }
        }

        async function silentRefresh() {
          try {
            const res = await fetch('/api/songs'); const raw = await res.json();
            if (raw.error) return;
            libState = raw; db = libState.songs;
            buildIndexMap(); renderCustomTabs(); renderAllLists();
            if(ap) {
              const ids = libState.all_order.length ? libState.all_order : db.map(s => s.file_id);
              ap.list.audios = ids.map(id => {
                const s = db[dbIndexMap.get(id)];
                return s ? { name: s.title, artist: s.artist, cover: s.cover || DEFAULT_LOGO, url: '/api/stream?file_id=' + s.file_id, lrc: s.lrc || '[00:00.00]暂无歌词' } : null;
              }).filter(Boolean);
            }
            if(document.getElementById('admin-panel').classList.contains('active')) {
              renderAdminPlaylistTabs(); renderAdminSongList();
            }
          } catch (e) { console.error(e); }
        }

        function buildIndexMap() { dbIndexMap.clear(); for(let j = 0; j < db.length; j++) dbIndexMap.set(db[j].file_id, j); }
        
        function setupPlayer() {
            if (ap) ap.destroy();
            const ids = libState.all_order.length ? libState.all_order : db.map(s => s.file_id);
            const trackList = ids.map(id => {
              const s = db[dbIndexMap.get(id)];
              if (!s) return null;
              const isFlac = (s.file_id && s.file_id.toLowerCase().includes('flac')) || (s.title && s.title.toLowerCase().includes('.flac'));
              return { 
                name: s.title, 
                artist: s.artist, 
                cover: s.cover || DEFAULT_LOGO, 
                url: '/api/stream?file_id=' + s.file_id, 
                lrc: s.lrc || '[00:00.00]暂无歌词',
                type: isFlac ? 'flac' : 'normal'
              };
            }).filter(Boolean);
            ap = new APlayer({ container: document.getElementById('ap-hidden'), lrcType: 1, audio: trackList, volume: parseFloat(localStorage.getItem('sarah-vol') || 0.7) });
            ap.on('play', () => { 
                const s = '<path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"></path>'; 
                document.getElementById('p-icon').innerHTML = s; document.getElementById('m-p-icon').innerHTML = s; 
                document.getElementById('m-disc-wrapper').classList.add('playing'); 
                refreshMeta(); updateMediaSession(); 
            });
            ap.on('pause', () => { 
                const s = '<path d="M8 5v14l11-7z"></path>'; 
                document.getElementById('p-icon').innerHTML = s; document.getElementById('m-p-icon').innerHTML = s; 
                document.getElementById('m-disc-wrapper').classList.remove('playing'); 
                if ('mediaSession' in navigator) navigator.mediaSession.playbackState = 'paused';
            });
            ap.on('timeupdate', () => { 
                if (isScrubbing) return;
                const cur = ap.audio.currentTime, dur = ap.audio.duration || 0, p = (cur / (dur || 1) * 100) + '%';
                ['prog-bar', 'm-prog-bar'].forEach(id => { const el = document.getElementById(id); if(el) el.style.width = p; });
                ['cur-time', 'm-cur-time'].forEach(id => { const el = document.getElementById(id); if(el) el.innerText = fmtTime(cur); });
                ['total-time', 'm-total-time'].forEach(id => { const el = document.getElementById(id); if(el) el.innerText = fmtTime(dur); });
                syncLyrics(cur);
            });
            ap.on('listswitch', (data) => { 
                const targetIdx = data.index !== undefined ? data.index : ap.list.index;
                refreshUIMetaByAudio(ap.list.audios[targetIdx]); updateBackground(true); 
            });
        }

        function updateMediaSession() { 
            const currentAudio = ap.list.audios[ap.list.index]; if (!('mediaSession' in navigator) || !currentAudio) return; 
            const fileId = new URLSearchParams(currentAudio.url.split('?')[1]).get('file_id'); 
            const song = db[dbIndexMap.get(fileId)] || { title: currentAudio.name, artist: currentAudio.artist, cover: currentAudio.cover };
            navigator.mediaSession.metadata = new MediaMetadata({ title: song.title, artist: song.artist, album: 'Sarah Music', artwork: [{ src: song.cover || DEFAULT_LOGO, sizes: '512x512', type: 'image/png' }] }); 
            navigator.mediaSession.playbackState = 'playing';
            navigator.mediaSession.setActionHandler('play', () => handlePlayToggle());
            navigator.mediaSession.setActionHandler('pause', () => handlePlayToggle());
            navigator.mediaSession.setActionHandler('previoustrack', () => handlePrev());
            navigator.mediaSession.setActionHandler('nexttrack', () => handleNext());
        }

        function updateBackground(isForceRandom = false) { 
            const isMob = window.innerWidth <= 768; 
            if (isForceRandom) { let nextIdx; do { nextIdx = Math.floor(Math.random() * solaraTheme.length); } while (nextIdx === currentThemeIdx && solaraTheme.length > 1); currentThemeIdx = nextIdx; } 
            const theme = solaraTheme[currentThemeIdx]; const finalBg = isMob ? '#4d7c5f' : theme.bg;
            const metaTheme = document.querySelector('meta[name="theme-color"]'); if(metaTheme) metaTheme.setAttribute('content', finalBg);
            document.body.style.backgroundColor = finalBg;
            if(!isMob) { 
                document.getElementById('bg-stage').style.background = \`linear-gradient(135deg, \${theme.bg} 0%, \${theme.deep} 100%)\`; 
                const mainUI = document.getElementById('main-ui'); if(mainUI) mainUI.style.background = \`linear-gradient(135deg, rgba(255,255,255,0.25) 0%, rgba(255,255,255,0.1) 100%)\`; 
            } else { document.getElementById('bg-stage').style.background = '#4d7c5f'; }
            document.documentElement.style.setProperty('--dynamic-accent', isMob ? '#ffffff' : theme.accent);
            const listTabs = document.querySelectorAll('#tabs-scroll div, .m-pl-card');
            listTabs.forEach(el => {
                const tabId = el.getAttribute('id') || ''; const mobileDataId = el.getAttribute('onclick') ? el.getAttribute('onclick').match(/'([^']+)'/)?.[1] : null;
                const isActive = (tabId === 'tab-play' && currentTab === 'all') || (tabId === 'tab-fav' && currentTab === 'fav') || (tabId === 'tab-pl-' + currentTab) || (mobileDataId === currentTab && el.classList.contains('m-pl-card'));
                el.classList.toggle('active', isActive);
                if (!el.classList.contains('m-pl-card')) { el.style.background = isActive ? theme.accent : 'transparent'; el.style.color = isActive ? 'white' : theme.accent; el.style.opacity = isActive ? '1' : '0.75'; }
            });
            document.querySelectorAll('.btn-round').forEach(el => {
                if(!el.classList.contains('!bg-white/10') && !el.parentElement.classList.contains('m-header') && !el.closest('#admin-panel')) { el.style.background = isMob ? '#ffffff' : theme.accent; el.style.color = isMob ? '#4d7c5f' : 'white'; }
                if(el.id === 'pc-settings-trigger' && !isMob) { el.style.color = 'white'; el.style.borderColor = 'rgba(255, 255, 255, 0.45)'; el.style.background = 'rgba(255, 255, 255, 0.25)'; }
            });
            renderAdminPlaylistTabs();
        }

        function refreshUIMetaByAudio(audio) { if(!audio) return; const fileId = new URLSearchParams(audio.url.split('?')[1]).get('file_id'); const idx = dbIndexMap.get(fileId); if(idx !== undefined) refreshUIMetaAt(idx); }
        
        function refreshUIMetaAt(idx) {
            const song = db[idx]; if (!song) return;
            if (lastActiveFileId !== song.file_id) { 
                const clipping = document.getElementById('m-clipping-node'); 
                if (clipping) { clipping.style.animation = 'none'; void clipping.offsetWidth; clipping.style.animation = ''; } 
                lastActiveFileId = song.file_id; 
            }
            const upUI = (imgId, logoId) => {
                const img = document.getElementById(imgId); const logo = document.getElementById(logoId);
                if(!img || !logo) return;
                if(song.cover) { img.style.display = 'none'; const n = new Image(); n.src = song.cover; n.onload = () => { img.src = song.cover; img.style.display = 'block'; logo.style.setProperty('display', 'none', 'important'); }; }
                else { img.style.display = 'none'; logo.style.setProperty('display', 'flex', 'important'); }
            };
            upUI('ui-cover', 'pc-logo-box'); upUI('m-ui-cover', 'm-logo-box');
            ['ui-title', 'm-ui-title'].forEach(id => { const el = document.getElementById(id); if(el) el.innerText = song.title; });
            ['ui-artist', 'm-ui-artist'].forEach(id => { const el = document.getElementById(id); if(el) el.innerText = song.artist; });
            const pattern = /\\[(\\d+):(\\d+).(\\d+)\\](.*)/;
            lrcLines = (song.lrc || "").split(/\\r?\\n/).map(l => { const m = pattern.exec(l); return m ? { t: parseInt(m[1]) * 60 + parseInt(m[2]), text: m[4].trim() } : null; }).filter(v => v && v.text);
            const renderL = (id) => {
                const el = document.getElementById(id); if(!el) return;
                if (!lrcLines.length) { el.innerHTML = '<div class="lrc-line active !opacity-30">暂无歌词</div>'; el.classList.add('justify-center'); }
                else { el.classList.remove('justify-center'); el.innerHTML = '<div style="height:65px;flex-shrink:0;"></div>' + lrcLines.map((l, i) => \`<div class="lrc-line" id="\${id}-lrc-\${i}" onclick="ap.seek(\${l.t})">\${l.text}</div>\`).join('') + '<div style="height:65px;flex-shrink:0;"></div>'; }
            };
            renderL('lrc-view'); renderL('m-lrc-flow');
            updateHighlights(song.file_id);
        }

        function syncLyrics(t) {
            if (!lrcLines.length) return;
            let active = -1; for (let i = 0; i < lrcLines.length; i++) if (t >= lrcLines[i].t) active = i;
            if (active !== -1) {
                ['lrc-view', 'm-lrc-flow'].forEach(id => {
                    const view = document.getElementById(id); if(!view) return;
                    view.querySelectorAll('.lrc-line').forEach((el, i) => el.classList.toggle('active', i === active));
                    const target = document.getElementById(id + '-lrc-' + active);
                    if (target) view.scrollTo({ top: target.offsetTop - (view.offsetHeight / 2) + (target.offsetHeight / 2), behavior: 'smooth' });
                });
            }
        }

        function refreshMeta() { if (!ap || !ap.list.audios.length) return; refreshUIMetaByAudio(ap.list.audios[ap.list.index]); }
        
        function updateHighlights(cid) {
            document.querySelectorAll('.song-item').forEach(el => { const isActive = el.dataset.id === cid; el.classList.toggle('active', isActive); if(isActive) el.scrollIntoView({ behavior: 'smooth', block: 'center' }); });
            const isFav = libState.favorites.includes(cid);
            ['fav-trigger', 'm-fav-trigger'].forEach(id => {
                const el = document.getElementById(id); if(!el) return;
                el.style.color = isFav ? '#ef4444' : (id === 'fav-trigger' ? 'rgba(0,0,0,0.2)' : 'white');
                el.querySelector('svg').setAttribute('fill', isFav ? 'currentColor' : 'none');
            });
        }

        function renderCustomTabs() { document.getElementById('custom-tabs').innerHTML = libState.playlists.map((pl, i) => \`<div id="tab-pl-\${i}" onclick="switchList('\${i}')" class="cursor-pointer px-3 py-2 rounded-lg font-black text-xs inline-block">\${pl.name}</div>\`).join(''); }
        
        function renderAllLists() {
            let ids = [];
            if(currentTab === 'all') ids = libState.all_order.length ? libState.all_order : db.map(s => s.file_id);
            else if(currentTab === 'fav') ids = libState.favorites;
            else ids = libState.playlists[parseInt(currentTab)]?.ids || [];
            
            const isMob = window.innerWidth <= 768;
            const q = document.getElementById(isMob ? 'm-list-search' : 'search-input').value.toLowerCase();
            let listData = ids.map(id => db[dbIndexMap.get(id)]).filter(Boolean);
            if (q) listData = listData.filter(s => s.title.toLowerCase().includes(q) || s.artist.toLowerCase().includes(q));

            const currentAudio = ap ? ap.list.audios[ap.list.index] : null;
            const currentId = currentAudio ? new URLSearchParams(currentAudio.url.split('?')[1]).get('file_id') : null;
            const html = listData.map(s => \`<div data-id="\${s.file_id}" onclick="handleTrackSwitch(\${dbIndexMap.get(s.file_id)}, '\${s.file_id}')" class="song-item group \${s.file_id === currentId ? 'active' : ''}"><img src="\${s.cover || DEFAULT_LOGO}" class="w-10 h-10 rounded-lg object-cover shadow-sm"><div class="flex-1 truncate"><div class="song-title-text truncate">\${s.title}</div><div class="song-artist-text truncate uppercase opacity-50 text-[10px]">\${s.artist}</div></div></div>\`).join('') || '<div class="py-20 text-center opacity-20 font-black text-white/40">列表暂无旋律</div>';
            document.getElementById('list-view').innerHTML = html;
            document.getElementById('m-list-view').innerHTML = html;
            if (currentId) updateHighlights(currentId);
        }

        async function handleTrackSwitch(idx, fid) {
            if(!ap) return;
            let targetIdx = idx;
            if (fid) { const foundIdx = ap.list.audios.findIndex(a => a.url.includes('file_id=' + fid)); if (foundIdx !== -1) targetIdx = foundIdx; }
            const targetVol = ap.audio.volume;
            for(let i=5; i>=0; i--) { ap.volume(targetVol * (i/5), true); await new Promise(r=>setTimeout(r, 10)); }
            ap.list.switch(targetIdx); ap.play();
            setTimeout(async () => { for(let i=0; i<=5; i++) { ap.volume(targetVol * (i/5), true); await new Promise(r=>setTimeout(r, 15)); } }, 100);
        }

        function toggleMode() { modeIdx = (modeIdx + 1) % modes.length; updateUIModes(); }
        function updateUIModes() {
            const m = modes[modeIdx]; if (ap) { ap.options.loop = m === 'single' ? 'one' : 'all'; ap.options.order = m === 'random' ? 'random' : 'list'; }
            const icons = {
                list: '<path d="M17 1l4 4-4 4"></path><path d="M3 11V9a4 4 0 0 1 4-4h14"></path><path d="M7 23l-4-4 4-4"></path><path d="M21 13v2a4 4 0 0 1-4 4H3"></path>',
                single: '<path d="M17 1l4 4-4 4"></path><path d="M3 11V9a4 4 0 0 1 4-4h14"></path><path d="M7 23l-4-4 4-4"></path><path d="M21 13v2a4 4 0 0 1-4 4H3"></path><path d="M11 9h1v6"></path><path d="M10 15h3"></path>',
                random: '<path d="M16 3h5v5"></path><path d="M4 20L21 3"></path><path d="M21 16v5h-5"></path><path d="M15 15l6 6"></path><path d="M4 4l5 5"></path>'
            };
            document.getElementById('mode-icon').innerHTML = icons[m]; document.getElementById('m-mode-icon').innerHTML = icons[m];
        }

        function handlePlayToggle() { if (!ap) return; if (ap.paused) ap.play(); else ap.pause(); }
        function handlePrev() {
            let ids = currentTab === 'all' ? (libState.all_order.length ? libState.all_order : db.map(s => s.file_id)) : (currentTab === 'fav' ? libState.favorites : (libState.playlists[parseInt(currentTab)]?.ids || []));
            const cur = ap.list.audios[ap.list.index]; if(!cur) return;
            const fileId = new URLSearchParams(cur.url.split('?')[1]).get('file_id');
            const idx = ids.indexOf(fileId); if(idx === -1) { handleTrackSwitch((ap.list.index - 1 + ap.list.audios.length) % ap.list.audios.length); return; }
            handleTrackSwitch(-1, ids[(idx - 1 + ids.length) % ids.length]);
        }
        function handleNext() {
            let ids = currentTab === 'all' ? (libState.all_order.length ? libState.all_order : db.map(s => s.file_id)) : (currentTab === 'fav' ? libState.favorites : (libState.playlists[parseInt(currentTab)]?.ids || []));
            const cur = ap.list.audios[ap.list.index]; if(!cur) return;
            const fileId = new URLSearchParams(cur.url.split('?')[1]).get('file_id');
            const idx = ids.indexOf(fileId);
            if (modes[modeIdx] === 'random' && ids.length > 1) {
                const others = ids.filter(i => i !== fileId);
                handleTrackSwitch(-1, others[Math.floor(Math.random() * others.length)]);
            } else {
                if(idx === -1) { handleTrackSwitch((ap.list.index + 1) % ap.list.audios.length); return; }
                handleTrackSwitch(-1, ids[(idx + 1) % ids.length]);
            }
        }

        function handleMouseSeekStart(e) { isScrubbing = true; handleMouseSeekMove(e); window.addEventListener('mousemove', handleMouseSeekMove); window.addEventListener('mouseup', handleMouseSeekEnd); }
        function handleMouseSeekMove(e) { if (!isScrubbing) return; const rect = document.getElementById('pc-scrubber').getBoundingClientRect(); const p = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width)); document.getElementById('prog-bar').style.width = (p * 100) + '%'; document.getElementById('cur-time').innerText = fmtTime(p * (ap.audio.duration || 0)); }
        function handleMouseSeekEnd(e) { if (!isScrubbing) return; const rect = document.getElementById('pc-scrubber').getBoundingClientRect(); const p = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width)); ap.seek(p * (ap.audio.duration || 0)); isScrubbing = false; window.removeEventListener('mousemove', handleMouseSeekMove); window.removeEventListener('mouseup', handleMouseSeekEnd); }

        function handleMouseVolStart(e) { isDraggingVol = true; handleMouseVolMove(e); window.addEventListener('mousemove', handleMouseVolMove); window.addEventListener('mouseup', handleMouseVolEnd); }
        function handleMouseVolMove(e) { if (!isDraggingVol) return; const rect = document.getElementById('pc-vol-rail').getBoundingClientRect(); const p = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width)); ap.volume(p, true); updateVolUI(p); }
        function handleMouseVolEnd() { isDraggingVol = false; window.removeEventListener('mousemove', handleMouseVolMove); window.removeEventListener('mouseup', handleMouseVolEnd); }

        function handleTouchStart(e) { isScrubbing = true; handleTouchMove(e); }
        function handleTouchMove(e) { if (!isScrubbing) return; if(e.cancelable) e.preventDefault(); const rect = document.getElementById('m-scrubber-wrap').getBoundingClientRect(); const p = Math.max(0, Math.min(1, (e.touches[0].clientX - rect.left) / rect.width)); document.getElementById('m-prog-bar').style.width = (p * 100) + '%'; document.getElementById('m-cur-time').innerText = fmtTime(p * (ap.audio.duration || 0)); }
        function handleTouchEnd(e) { if (!isScrubbing) return; const rect = document.getElementById('m-scrubber-wrap').getBoundingClientRect(); const p = Math.max(0, Math.min(1, (e.changedTouches[0].clientX - rect.left) / rect.width)); ap.seek(p * (ap.audio.duration || 0)); isScrubbing = false; }

        function toggleMute() { if (isMuted) { ap.volume(lastVolume, true); updateVolUI(lastVolume); isMuted = false; } else { lastVolume = ap.audio.volume; ap.volume(0, true); updateVolUI(0); isMuted = true; } }
        function updateVolUI(p) { const vBar = document.getElementById('vol-bar'), vIcon = document.getElementById('v-icon'); if(vBar) vBar.style.width = (p * 100) + '%'; if(vIcon) vIcon.innerHTML = p === 0 ? '<path d="M11 5L6 9H2v6h4l5 4V5zM22 9l-6 6m0-6l6 6"></path>' : (p < 0.5 ? '<path d="M11 5L6 9H2v6h4l5 4V5zM15.54 8.46a5 5 0 0 1 0 7.07"></path>' : '<path d="M11 5L6 9H2v6h4l5 4V5zM19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07"></path>'); localStorage.setItem('sarah-vol', p); }

        function handleSearch() { renderAllLists(); }
        function clearSearch(id) { document.getElementById(id).value = ""; renderAllLists(); }
        
        function setSleep(mins) { 
            if(sleepTimerInt) clearInterval(sleepTimerInt); 
            const statusEl = document.getElementById('sleep-status'); 
            if(mins === 0) { sleepEndTime = null; statusEl.innerText = ""; } 
            else { 
                sleepEndTime = Date.now() + mins * 60000; 
                sleepTimerInt = setInterval(() => { 
                    const diff = sleepEndTime - Date.now(); 
                    if(diff <= 0) { ap.pause(); clearInterval(sleepTimerInt); sleepEndTime = null; statusEl.innerText = ""; } 
                    else { statusEl.innerText = fmtTime(Math.floor(diff/1000)); } 
                }, 1000); 
            } 
        }

        function fmtTime(s) { if (isNaN(s) || s < 0) return "00:00"; const m = Math.floor(s/60), sec = Math.floor(s%60); return (m<10?"0"+m:m)+":"+(sec<10?"0"+sec:sec); }
        
        async function handleLikeToggle() { 
            const cur = ap.list.audios[ap.list.index]; if(!cur) return; 
            const fileId = new URLSearchParams(cur.url.split('?')[1]).get('file_id');
            if (libState.favorites.includes(fileId)) libState.favorites = libState.favorites.filter(id => id !== fileId);
            else libState.favorites.push(fileId);
            updateHighlights(fileId);
            await dbOp('toggle_fav', { file_id: fileId }); silentRefresh(); 
        }

        function switchList(t) { currentTab = t; updateBackground(false); renderAllLists(); }
        function switchAdminList(t) { currentAdminTab = t; renderAdminPlaylistTabs(); renderAdminSongList(); }
        function toggleAdmin(s) { document.getElementById('admin-panel').classList.toggle('active', s); if(s) { currentAdminTab = currentTab; renderAdminPlaylistTabs(); renderAdminSongList(); } }
        function toggleUploadArea() { document.getElementById('sleep-area').classList.add('hidden'); document.getElementById('upload-area').classList.toggle('hidden'); }
        function toggleSleepArea() { document.getElementById('upload-area').classList.add('hidden'); document.getElementById('sleep-area').classList.toggle('hidden'); }

        function showSarahDialog(title, msg, isInput, def, cb) { 
            const ov = document.getElementById('sarah-dialog'); document.getElementById('dialog-title').innerText = title; document.getElementById('dialog-msg').innerText = msg;
            const inp = document.getElementById('dialog-input'); if(isInput) { document.getElementById('dialog-input-wrap').classList.remove('hidden'); inp.value = def || ""; } else document.getElementById('dialog-input-wrap').classList.add('hidden');
            document.getElementById('dialog-confirm').onclick = () => { ov.classList.add('hidden'); ov.classList.remove('active'); ov.style.display = 'none'; cb(isInput ? inp.value : true); }; 
            ov.classList.remove('hidden'); ov.classList.add('active'); ov.style.display = 'flex';
        }
        function closeSarahDialog() { const ov = document.getElementById('sarah-dialog'); ov.classList.add('hidden'); ov.classList.remove('active'); ov.style.display = 'none'; }

        function renderAdminPlaylistTabs() {
            const container = document.getElementById('admin-playlist-tabs'); if(!container) return;
            let html = \`<div class="browser-tab \${currentAdminTab === 'all' ? 'active' : ''}" onclick="switchAdminList('all')"><span class="browser-tab-text">全库 <i class="opacity-40 text-[9px] font-black italic">\${libState.songs.length}</i></span></div><div class="browser-tab \${currentAdminTab === 'fav' ? 'active' : ''}" onclick="switchAdminList('fav')"><span class="browser-tab-text">收藏 <i class="opacity-40 text-[9px] font-black italic">\${libState.favorites.length}</i></span></div>\`;
            libState.playlists.forEach((pl, i) => { html += \`<div class="browser-tab \${currentAdminTab === i.toString() ? 'active' : ''}" onclick="switchAdminList('\${i}')" ondblclick="renamePlaylistPrompt('\${i}')"><span class="browser-tab-text">\${pl.name} <i class="opacity-40 text-[9px] font-black italic">\${pl.ids.length}</i></span><div class="browser-tab-close" onclick="event.stopPropagation(); deletePlaylist('\${i}')"><svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="3"><path d="M6 18L18 6M6 6l12 12"></path></svg></div></div>\`; });
            html += \`<div class="browser-tab" onclick="addPlaylistPrompt()" style="min-width:40px;flex:none;"><span class="browser-tab-text" style="opacity:1;color:white;font-size:14px;font-weight:bold;">+</span></div>\`;
            container.innerHTML = html;
        }

        async function renderUploadLogs() {
            const container = document.getElementById('admin-song-list');
            container.innerHTML = '<div class="py-10 text-center text-white/40 animate-pulse">正在获取 D1 日志...</div>';
            const res = await dbOp('get_logs');
            if (!res.success) { container.innerHTML = '<div class="py-10 text-center text-red-300">获取日志失败</div>'; return; }
            container.innerHTML = res.logs.map(log => \`
                <div class="p-4 bg-white/5 rounded-2xl mb-2 flex flex-col gap-1 border border-white/5">
                    <div class="flex justify-between items-center">
                        <span class="text-[12px] font-black text-white truncate max-w-[70%]">\${log.filename}</span>
                        <span class="text-[9px] px-2 py-0.5 rounded \${log.status === 'SUCCESS' ? 'bg-emerald-500/20 text-emerald-400' : 'bg-red-500/20 text-red-400'}">\${log.status}</span>
                    </div>
                    <div class="text-[10px] text-white/40 italic">\${log.reason || '无详情'}</div>
                    <div class="text-[8px] text-white/20 text-right mt-1">\${new Date(log.timestamp).toLocaleString()}</div>
                </div>
            \`).join('') || '<div class="py-10 text-center text-white/20">暂无上传记录</div>';
        }

        function renderAdminSongList() {
            const container = document.getElementById('admin-song-list');
            let ids = [];
            if(currentAdminTab === 'all') ids = libState.all_order.length ? libState.all_order : db.map(s => s.file_id);
            else if(currentAdminTab === 'fav') ids = libState.favorites;
            else if(currentAdminTab === 'logs') { renderUploadLogs(); return; }
            else ids = libState.playlists[parseInt(currentAdminTab)]?.ids || [];
            const list = ids.map(id => db[dbIndexMap.get(id)]).filter(Boolean);
            container.innerHTML = list.map((s, i) => \`<div class="admin-song-row" id="admin-row-\${i}" data-fileid="\${s.file_id}" onmousedown="handleAdminDragStart(event, \${i}, false)" ontouchstart="handleAdminDragStart(event, \${i}, true)"><div class="admin-song-info"><input class="admin-song-input admin-song-title-input" value="\${s.title}" readonly onchange="updateSongInfo('\${s.file_id}', 'title', this.value)"><input class="admin-song-input admin-song-artist-input" value="\${s.artist}" readonly onchange="updateSongInfo('\${s.file_id}', 'artist', this.value)"></div><div class="admin-action-group"><div class="admin-action-btn" onclick="openPlaylistSelector('\${s.file_id}')"><svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2.5"><path d="M12 4v16m8-8H4"></path></svg></div><div class="admin-action-btn delete" onclick="deleteSong('\${s.file_id}')"><svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2.5"><path d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path></svg></div><div class="admin-action-btn" onclick="toggleEditMode(\${i})"><svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2.5"><path d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"></path></svg></div></div></div>\`).join('') || '<div class="py-10 text-center text-white/20 text-xs">暂无歌曲</div>';
        }

        // 旗舰级稳拽排序逻辑 (100% 还原协议要求)
        function handleAdminDragStart(e, idx, isTouch) {
            if ((e.target.tagName === 'INPUT' && !e.target.readOnly) || e.target.closest('.admin-action-btn')) return;
            const targetEl = e.currentTarget; let lastY = isTouch ? e.touches[0].clientY : e.clientY; let lastX = isTouch ? e.touches[0].clientX : e.clientX;
            const initDrag = (cX, cY) => {
                if (currentDraggedEl) return; currentDraggedEl = targetEl; const rect = currentDraggedEl.getBoundingClientRect();
                touchOffsetTop = cY - rect.top; dragPlaceholder = document.createElement('div'); dragPlaceholder.className = 'admin-song-placeholder';
                currentDraggedEl.parentNode.insertBefore(dragPlaceholder, currentDraggedEl);
                const ghost = currentDraggedEl.cloneNode(true); ghost.classList.add('is-dragging'); ghost.style.width = rect.width + 'px'; ghost.style.left = rect.left + 'px'; ghost.style.top = (cY - touchOffsetTop) + 'px'; document.body.appendChild(ghost);
                currentDraggedEl.classList.add('is-hidden');
                const move = (me) => {
                    if (me.cancelable) me.preventDefault(); const mY = me.touches ? me.touches[0].clientY : me.clientY; const mX = me.touches ? me.touches[0].clientX : me.clientX;
                    ghost.style.top = (mY - touchOffsetTop) + 'px'; const hov = document.elementFromPoint(mX, mY)?.closest('.admin-song-row');
                    if (hov && hov !== currentDraggedEl && hov !== dragPlaceholder) { const r = hov.getBoundingClientRect(); if (mY < r.top + r.height / 2) hov.parentNode.insertBefore(dragPlaceholder, hov); else hov.parentNode.insertBefore(dragPlaceholder, hov.nextSibling); }
                };
                const end = async () => {
                    window.removeEventListener(isTouch ? 'touchmove' : 'mousemove', move); window.removeEventListener(isTouch ? 'touchend' : 'mouseup', end);
                    if (dragPlaceholder) { dragPlaceholder.parentNode.insertBefore(currentDraggedEl, dragPlaceholder); dragPlaceholder.remove(); }
                    if (ghost) ghost.remove(); currentDraggedEl.classList.remove('is-hidden');
                    const nIds = Array.from(document.querySelectorAll('#admin-song-list .admin-song-row')).map(r => r.dataset.fileid);
                    const pid = currentAdminTab === 'all' ? 'all' : (currentAdminTab === 'fav' ? 'fav' : libState.playlists[parseInt(currentAdminTab)].id);
                    await dbOp('update_order', { playlist_id: pid, ids: nIds }); silentRefresh();
                    currentDraggedEl = null; dragPlaceholder = null;
                };
                window.addEventListener(isTouch ? 'touchmove' : 'mousemove', move, { passive: false }); window.addEventListener(isTouch ? 'touchend' : 'mouseup', end);
            };
            if (isTouch) {
                if(longPressTimer) clearTimeout(longPressTimer); longPressTimer = setTimeout(() => { if (navigator.vibrate) navigator.vibrate(50); initDrag(lastX, lastY); }, 500);
                targetEl.addEventListener('touchmove', (te) => { lastX = te.touches[0].clientX; lastY = te.touches[0].clientY; if (Math.abs(lastY - initialTouchY) > 10) clearTimeout(longPressTimer); }, { passive: true });
                targetEl.addEventListener('touchend', () => clearTimeout(longPressTimer), { once: true });
            } else initDrag(e.clientX, e.clientY);
        }

        function toggleEditMode(idx) {
            const row = document.getElementById('admin-row-' + idx); const isE = row.classList.toggle('editing');
            const inputs = row.querySelectorAll('.admin-song-input'); inputs.forEach(i => i.readOnly = !isE); if(isE) inputs[0].focus();
        }

        async function updateSongInfo(fid, field, val) { const s = db.find(x => x.file_id === fid); if(s) { s[field] = val; await dbOp('update_song', s); silentRefresh(); } }
        
        function deleteSong(fid) {
            const pid = currentAdminTab === 'all' ? 'all' : (currentAdminTab === 'fav' ? 'fav' : libState.playlists[parseInt(currentAdminTab)].id);
            showSarahDialog("删除确认", \`确定将此旋律从\${pid === 'all' ? '全库永久抹去' : '当前歌单移除'}吗？\`, false, null, async (y) => { if(y) { await dbOp('delete_song', { file_id: fid, playlist_id: pid }); silentRefresh(); } }); 
        }

        function openPlaylistSelector(fid) {
            document.getElementById('playlist-selector-list').innerHTML = libState.playlists.map(pl => {
                const ex = pl.ids.includes(fid);
                return \`<div onclick="addToPlaylist('\${pl.id}', '\${fid}')" class="p-4 bg-white/10 rounded-2xl flex justify-between items-center cursor-pointer hover:bg-white/20 \${ex?'text-emerald-400 font-bold':''}">\${ex ? \`<span class="text-emerald-400">\${pl.name}</span>\` : \`<span class="text-white">\${pl.name}</span>\`} \${ex ? '<span class="text-[10px] text-emerald-400">已添加</span>' : '<span class="text-white font-bold text-lg">+</span>'}</div>\`;
            }).join('');
            document.getElementById('playlist-selector-modal').classList.remove('hidden'); document.getElementById('playlist-selector-modal').classList.add('flex');
        }
        function closePlaylistSelector() { document.getElementById('playlist-selector-modal').classList.add('hidden'); }
        async function addToPlaylist(pid, fid) { await dbOp('add_to_playlist', { playlist_id: pid, file_id: fid }); await silentRefresh(); openPlaylistSelector(fid); }

        function addPlaylistPrompt() { showSarahDialog("新歌单", "名称：", true, "", async (n) => { if(n) { await dbOp('add_playlist', { name: n }); silentRefresh(); } }); }
        function renamePlaylistPrompt(idx) { showSarahDialog("重命名", "新名称：", true, libState.playlists[idx].name, async (n) => { if(n) { await dbOp('rename_playlist', { id: libState.playlists[idx].id, name: n }); init(); } }); }
        function deletePlaylist(idx) { showSarahDialog("删除", "确定删除此列表吗？", false, null, async (y) => { if(y) { await dbOp('delete_playlist', { id: libState.playlists[idx].id }); silentRefresh(); } }); }

        function previewTag(inp) {
            const files = Array.from(inp.files); document.getElementById('file-count-tip').innerText = \`已选 \${files.length} 首\`;
            const container = document.getElementById('upload-preview-list');
            let processed = 0;
            files.forEach((f, i) => {
                const pId = "up-p-" + Date.now() + i;
                container.innerHTML += \`<div class="upload-preview-item" id="\${pId}"><div class="flex items-center justify-between"><span class="text-xs text-white truncate w-2/3">\${f.name}</span><div id="\${pId}-s" class="preview-status-dot"></div></div><div class="preview-prog-container" id="\${pId}-w"><div class="preview-prog-fill" id="\${pId}-f"></div></div></div>\`;
                jsmediatags.read(f, { onSuccess: (t) => {
                    const { title, artist, picture, lyrics } = t.tags; let blob = null;
                    if (picture) { const { data, format } = picture; blob = new Blob([new Uint8Array(data)], { type: format }); }
                    tempMetaMap.set(f.name, { title: title || f.name.replace(/\\.[^/.]+$/, ""), artist: artist || "未知", coverBlob: blob, lrc: lyrics?.lyrics || "" });
                    processed++; if(processed === files.length) setTimeout(() => handleUp(files, pId.split('-').pop()), 500);
                }, onError: () => { processed++; if(processed === files.length) setTimeout(() => handleUp(files, pId.split('-').pop()), 500); }});
            });
        }

        async function handleUp(files, baseId) {
            if(!files.length) return;
            const btn = document.querySelector("#upload-area button"); if(btn) btn.disabled = true;
            const targetPid = (currentAdminTab !== 'all' && currentAdminTab !== 'fav' && currentAdminTab !== 'logs') ? libState.playlists[parseInt(currentAdminTab)].id : null;
            
            const worker = async (f, i) => {
                const pId = document.querySelectorAll(".upload-preview-item")[document.querySelectorAll(".upload-preview-item").length - files.length + i].id;
                const sDot = document.getElementById(pId + "-s"), pWrap = document.getElementById(pId + "-w"), pFill = document.getElementById(pId + "-f");
                if(sDot) sDot.className = "preview-status-dot uploading"; if(pWrap) pWrap.style.display = "block";
                const meta = tempMetaMap.get(f.name) || { title: f.name };
                const fd = new FormData(); fd.append('file', f); fd.append('meta', JSON.stringify(meta));
                if (meta.coverBlob) fd.append('cover', meta.coverBlob, 'cover.jpg');
                if (targetPid) fd.append('target_playlist', targetPid);
                const xhr = new XMLHttpRequest(); xhr.open('POST', '/api/upload');
                xhr.upload.onprogress = e => { if(e.lengthComputable) pFill.style.width = (e.loaded/e.total*100) + '%'; };
                await new Promise(r => {
                    xhr.onload = () => { 
                        const res = JSON.parse(xhr.responseText || '{}');
                        if(xhr.status === 200 && res.success) { if(sDot) sDot.className = "preview-status-dot success"; }
                        else { if(sDot) sDot.className = "preview-status-dot error"; console.error("Upload Fail:", res.error); }
                        r(); 
                    };
                    xhr.onerror = () => { if(sDot) sDot.className = "preview-status-dot error"; r(); };
                    xhr.send(fd);
                });
            };

            for(let i=0; i<files.length; i++) {
                await worker(files[i], i);
            }
            
            showMsg("✅ 同步流程结束"); if(btn) btn.disabled = false; silentRefresh();
            if(currentAdminTab === 'logs') renderUploadLogs();
            setTimeout(() => { const list = document.getElementById('upload-preview-list'); if(list) list.innerHTML = ""; }, 10000);
        }

        function toggleMobileDrawer(s) {
            const d = document.getElementById('m-drawer'), o = document.getElementById('m-overlay');
            if(s) { 
                const h = [{id:'all',name:'全库'}, {id:'fav',name:'收藏'}, ...libState.playlists.map((p,i)=>({id:i.toString(),name:p.name}))];
                document.getElementById('m-pl-cards').innerHTML = h.map(c => \`<div onclick="switchList('\${c.id}')" class="m-pl-card \${currentTab===c.id?'active':''}">\${c.name}</div>\`).join('');
                d.classList.add('active'); o.style.display = 'block'; 
            } else { d.classList.remove('active'); o.style.display = 'none'; }
        }

        function showMsg(txt) { const b = document.getElementById('msg-box'); b.innerText = txt; b.classList.add('active'); setTimeout(() => b.classList.remove('active'), 3000); }
        window.onload = init;
    </script>
</body>
</html>`;

// --- Deployment ---
try {
    const wp = path.join(process.cwd(), 'wrangler.toml');
    if (fs.existsSync(wp)) fs.unlinkSync(wp);
    Object.keys(files).forEach((f) => {
        const d = path.dirname(f);
        if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
        fs.writeFileSync(f, files[f].trim());
    });
    console.log('\n---正在同步至 GitHub (9.2.5 D1 无损旗舰版)---');
    try {
        try { execSync('git init'); } catch(e){}
        execSync('git add .');
        execSync('git commit -m "' + COMMIT_MSG + '"');
        execSync('git branch -M main');
        try { execSync('git remote add origin ' + REMOTE_URL); } catch(e){}
        execSync('git push -u origin main --force');
        console.log('\n✅ Sarah MUSIC 9.2.5 构建成功。已彻底解决FLAC播放问题，优化上传预览累加显示，统一UI图标。');
    } catch(e) { console.error('\n❌ Git 同步失败。'); }
} catch (err) { console.error('\n❌ 构建失败: ' + err.message); }
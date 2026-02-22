export async function onRequest(context) {
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
}
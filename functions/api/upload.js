export async function onRequest(context) {
  const { request, env } = context;
  const BOT_TOKEN = env.TG_Bot_Token;
  const CHAT_ID = env.TG_Chat_ID;
  
  // 自动初始化日志表
  await env.DB.prepare("CREATE TABLE IF NOT EXISTS upload_logs (id INTEGER PRIMARY KEY AUTOINCREMENT, filename TEXT, status TEXT, reason TEXT, timestamp DATETIME DEFAULT CURRENT_TIMESTAMP)").run();

  let filename = "Unknown";
  try {
    const formData = await request.formData();
    const file = formData.get('file');
    filename = file.name || "Unknown";
    const meta = JSON.parse(formData.get('meta') || '{}');
    
    const tgFormData = new FormData();
    tgFormData.append('chat_id', CHAT_ID);
    tgFormData.append('audio', file);
    
    const tgRes = await fetch("https://api.telegram.org/bot" + BOT_TOKEN + "/sendAudio", { method: 'POST', body: tgFormData });
    const result = await tgRes.json();
    
    if (!result.ok) {
      const errorMsg = result.description || "Telegram API Error";
      await env.DB.prepare("INSERT INTO upload_logs (filename, status, reason) VALUES (?, 'FAIL', ?)").bind(filename, errorMsg).run();
      return new Response(JSON.stringify({ success: false, error: errorMsg }), { status: 400 });
    }
    
    const fid = result.result.audio.file_id;
    await env.DB.prepare("INSERT INTO songs (file_id, title, artist, cover, lrc) VALUES (?1, ?2, ?3, ?4, ?5)")
      .bind(fid, meta.title || "未知", meta.artist || "未知", meta.cover || "", meta.lrc || "").run();
    
    await env.DB.prepare("INSERT INTO playlist_mapping (playlist_id, file_id, sort_order) VALUES ('all', ?, ?)")
      .bind(fid, Date.now()).run();

    await env.DB.prepare("INSERT INTO upload_logs (filename, status, reason) VALUES (?, 'SUCCESS', 'OK')").bind(filename).run();
    return new Response(JSON.stringify({ success: true, file_id: fid }));
  } catch (err) { 
    await env.DB.prepare("INSERT INTO upload_logs (filename, status, reason) VALUES (?, 'FAIL', ?)").bind(filename, err.message).run();
    return new Response(JSON.stringify({ success: false, error: err.message }), { status: 500 }); 
  }
}
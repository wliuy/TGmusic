export async function onRequest(context) {
  const { request, env } = context;
  
  const PASS = env.PASSWORD;
  if (PASS) {
    const auth = request.headers.get('X-Sarah-Password');
    if (auth !== PASS) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), { 
        status: 401, 
        headers: { 'Content-Type': 'application/json' } 
      });
    }
  }

  const BOT_TOKEN = env.TG_Bot_Token;
  const CHAT_ID = env.TG_Chat_ID;
  const DB = env.DB;
  try {
    const formData = await request.formData();
    const file = formData.get('file');
    const metaStr = formData.get('meta') || '{}';
    let meta = { title: "未知歌曲", artist: "未知作者", cover: "", lrc: "" };
    try { meta = { ...meta, ...JSON.parse(metaStr) }; } catch(e) {}
    const tgFormData = new FormData();
    tgFormData.append('chat_id', CHAT_ID);
    tgFormData.append('audio', file);
    const tgRes = await fetch("https://api.telegram.org/bot" + BOT_TOKEN + "/sendAudio", { 
      method: 'POST', 
      body: tgFormData 
    });
    const result = await tgRes.json();
    if (!result.ok) return new Response(JSON.stringify(result), { status: 400 });
    const file_id = result.result.audio ? result.result.audio.file_id : (result.result.document ? result.result.document.file_id : null);
    if (!file_id) return new Response(JSON.stringify({ ok: false }), { status: 400 });
    // D1 事务：采用 INSERT OR IGNORE 解决冲突失败，确保即便 file_id 已存在也能逻辑闭环
    await DB.batch([
      DB.prepare("INSERT OR REPLACE INTO songs (file_id, title, artist, cover, lrc) VALUES (?, ?, ?, ?, ?)").bind(file_id, meta.title, meta.artist, meta.cover, meta.lrc),
      DB.prepare("INSERT OR IGNORE INTO playlist_songs (playlist_id, file_id, sort_order) VALUES ('all', ?, (SELECT IFNULL(MAX(sort_order), 0) + 1 FROM playlist_songs WHERE playlist_id = 'all'))").bind(file_id)
    ]);
    return new Response(JSON.stringify({ 
      success: true, 
      file_id: file_id 
    }), { headers: { 'Content-Type': 'application/json' } });
  } catch (err) { 
    return new Response(err.message, { status: 500 }); 
  }
}
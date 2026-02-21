export async function onRequest(context) {
  const { request, env } = context;
  const BOT_TOKEN = env.TG_Bot_Token;
  const CHAT_ID = env.TG_Chat_ID;
  try {
    const formData = await request.formData();
    const file = formData.get('file');
    const meta = JSON.parse(formData.get('meta') || '{}');
    const tgFormData = new FormData();
    tgFormData.append('chat_id', CHAT_ID);
    tgFormData.append('audio', file);
    const tgRes = await fetch("https://api.telegram.org/bot" + BOT_TOKEN + "/sendAudio", { method: 'POST', body: tgFormData });
    const result = await tgRes.json();
    if (!result.ok) return new Response(JSON.stringify(result), { status: 400 });
    const fid = result.result.audio.file_id;
    await env.DB.prepare("INSERT INTO songs (file_id, title, artist, cover, lrc) VALUES (?1, ?2, ?3, ?4, ?5)")
      .bind(fid, meta.title || "未知", meta.artist || "未知", meta.cover || "", meta.lrc || "").run();
    // 默认归入全库列表
    await env.DB.prepare("INSERT INTO playlist_mapping (playlist_id, file_id, sort_order) VALUES ('all', ?, ?)")
      .bind(fid, Date.now()).run();
    return new Response(JSON.stringify({ success: true, file_id: fid }));
  } catch (err) { return new Response(err.message, { status: 500 }); }
}
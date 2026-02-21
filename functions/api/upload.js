export async function onRequest(context) {
  const { request, env } = context;
  const BOT_TOKEN = env.TG_Bot_Token;
  const CHAT_ID = env.TG_Chat_ID;
  try {
    const formData = await request.formData();
    const file = formData.get('file');
    const tgFormData = new FormData();
    tgFormData.append('chat_id', CHAT_ID);
    tgFormData.append('audio', file);
    const tgRes = await fetch("https://api.telegram.org/bot" + BOT_TOKEN + "/sendAudio", { method: 'POST', body: tgFormData });
    const result = await tgRes.json();
    if (!result.ok) return new Response(JSON.stringify(result), { status: 400 });
    return new Response(JSON.stringify({ success: true, file_id: result.result.audio.file_id }), { headers: { 'Content-Type': 'application/json' } });
  } catch (err) { return new Response(err.message, { status: 500 }); }
}
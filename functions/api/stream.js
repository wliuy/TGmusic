export async function onRequest(context) {
  const { request, env } = context;
  const PASS = env.PASSWORD;
  const url = new URL(request.url);
  const fileId = url.searchParams.get('file_id');
  const auth = url.searchParams.get('auth');
  const BOT_TOKEN = env.TG_Bot_Token;

  if (PASS && auth !== PASS) {
    return new Response("Unauthorized", { status: 401 });
  }
  
  if (!fileId || !BOT_TOKEN) {
    return new Response("Params error", { status: 400 });
  }

  try {
    const getFileUrl = "https://api.telegram.org/bot" + BOT_TOKEN + "/getFile?file_id=" + fileId;
    const fileInfo = await (await fetch(getFileUrl)).json();
    if (!fileInfo.ok) return new Response("TG API Fault", { status: 400 });
    
    const downloadUrl = "https://api.telegram.org/file/bot" + BOT_TOKEN + "/" + fileInfo.result.file_path;
    const range = request.headers.get('Range');
    const fileRes = await fetch(downloadUrl, { 
      headers: range ? { 'Range': range } : {} 
    });
    
    const headers = new Headers(fileRes.headers);
    headers.set('Access-Control-Allow-Origin', '*');
    headers.set('Cache-Control', 'public, max-age=31536000');
    
    return new Response(fileRes.body, { status: fileRes.status, headers });
  } catch (err) { 
    return new Response("Service Error", { status: 500 }); 
  }
}
let urlCache = new Map();
export async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const fileId = url.searchParams.get('file_id');
  const BOT_TOKEN = env.TG_Bot_Token;
  if (!fileId || !BOT_TOKEN) return new Response("Params error", { status: 400 });
  try {
    let cacheItem = urlCache.get(fileId);
    let downloadUrl = "";
    if (cacheItem && Date.now() < cacheItem.expiry) {
      downloadUrl = cacheItem.url;
    } else {
      const getFileUrl = "https://api.telegram.org/bot" + BOT_TOKEN + "/getFile?file_id=" + fileId;
      const fileInfo = await (await fetch(getFileUrl)).json();
      if (!fileInfo.ok) return new Response("TG API Fault", { status: 400 });
      downloadUrl = "https://api.telegram.org/file/bot" + BOT_TOKEN + "/" + fileInfo.result.file_path;
      urlCache.set(fileId, { url: downloadUrl, expiry: Date.now() + 1800000 });
    }
    const range = request.headers.get('Range');
    const fileRes = await fetch(downloadUrl, { headers: range ? { 'Range': range } : {} });
    const headers = new Headers(fileRes.headers);
    headers.set('Access-Control-Allow-Origin', '*');
    headers.set('Cache-Control', 'public, max-age=31536000');
    if (!headers.has('Content-Type')) {
      headers.set('Content-Type', downloadUrl.toLowerCase().endsWith('.flac') ? 'audio/flac' : 'audio/mpeg');
    }
    return new Response(fileRes.body, { status: fileRes.status, headers });
  } catch (err) { return new Response("Service Error", { status: 500 }); }
}
const mask = (v) => {
  if (!v) return null;
  const s = String(v);
  return { len: s.length, head: s.slice(0, 6) + '***', tail: '***' + s.slice(-4) };
};

export async function onRequest(context) {
  const { request, env } = context;
  if (request.headers.get('X-Password') !== (env.PASSWORD || 'sarah')) {
    return new Response('Unauthorized', { status: 401 });
  }
  const body = {
    keys: Object.keys(env).sort(),
    TG_Bot_Token: mask(env.TG_Bot_Token),
    TG_Chat_ID: mask(env.TG_Chat_ID),
    PASSWORD: mask(env.PASSWORD),
    DB: env.DB ? 'present' : null,
    DB_has_prepare: typeof env.DB?.prepare === 'function'
  };

  // 探测 Telegram API：getMe 验证 token 本身，getFile 验证 file_id 归属
  try {
    const me = await (await fetch(`https://api.telegram.org/bot${env.TG_Bot_Token}/getMe`)).json();
    body.tg_getMe = me.ok ? { ok: true, username: me.result?.username, id: me.result?.id } : { ok: false, code: me.error_code, desc: me.description };
  } catch (e) { body.tg_getMe = { thrown: String(e) }; }

  const fid = new URL(request.url).searchParams.get('file_id');
  if (fid) {
    try {
      const gf = await (await fetch(`https://api.telegram.org/bot${env.TG_Bot_Token}/getFile?file_id=${encodeURIComponent(fid)}`)).json();
      body.tg_getFile = gf.ok ? { ok: true, path: gf.result?.file_path } : { ok: false, code: gf.error_code, desc: gf.description };
    } catch (e) { body.tg_getFile = { thrown: String(e) }; }
  }
  return new Response(JSON.stringify(body, null, 2), {
    headers: { 'Content-Type': 'application/json' }
  });
}

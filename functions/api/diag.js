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
  return new Response(JSON.stringify(body, null, 2), {
    headers: { 'Content-Type': 'application/json' }
  });
}

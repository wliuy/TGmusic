import { authRequired, checkPassword } from '../_lib/auth.js';

// GET  ：告诉前端「这个站点要不要密码」。没设 PASSWORD 就免密直进。
// POST ：校验密码。
export async function onRequest(context) {
  const { request, env } = context;
  if (request.method === 'GET') {
    return new Response(JSON.stringify({ required: authRequired(env) }), {
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }
    });
  }
  if (request.method !== 'POST') return new Response("Bad Method", { status: 405 });
  try {
    const { password } = await request.json();
    const ok = checkPassword(env, password);
    return new Response(JSON.stringify({ success: ok, required: authRequired(env) }), {
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }
    });
  } catch (err) {
    return new Response(JSON.stringify({ success: false }), { status: 500 });
  }
}

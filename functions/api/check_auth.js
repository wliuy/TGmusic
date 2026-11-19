import { passwordMatches, createSession, sessionCookie, clearCookie, isAuthed } from '../_auth.js';

// 简单的内存限流：同一 IP 10 分钟内最多错 8 次。Workers 实例重启会清零，够挡掉脚本爆破。
const WINDOW_MS = 10 * 60 * 1000;
const MAX_FAILS = 8;
const fails = new Map();

function tooManyAttempts(ip) {
  const rec = fails.get(ip);
  if (!rec) return false;
  if (Date.now() - rec.first > WINDOW_MS) { fails.delete(ip); return false; }
  return rec.count >= MAX_FAILS;
}

function noteFail(ip) {
  const rec = fails.get(ip);
  if (!rec || Date.now() - rec.first > WINDOW_MS) fails.set(ip, { count: 1, first: Date.now() });
  else rec.count++;
}

function json(body, status = 200, headers = {}) {
  return new Response(JSON.stringify(body), {
    status, headers: { 'Content-Type': 'application/json', ...headers }
  });
}

export async function onRequest(context) {
  const { request, env } = context;

  // GET：只回答"当前是否已登录"，用于刷新页面时免密进入
  if (request.method === 'GET') {
    return json({ authed: await isAuthed(request, env) });
  }
  // 退出登录
  if (request.method === 'DELETE') {
    return json({ success: true }, 200, { 'Set-Cookie': clearCookie(request) });
  }
  if (request.method !== 'POST') return new Response('Bad Method', { status: 405 });

  const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
  if (tooManyAttempts(ip)) {
    return json({ success: false, error: '尝试次数过多，请 10 分钟后再试' }, 429);
  }

  let password;
  try { ({ password } = await request.json()); } catch { return json({ success: false }, 400); }

  if (!passwordMatches(env, password)) {
    noteFail(ip);
    return json({ success: false }, 401);
  }

  fails.delete(ip);
  const token = await createSession(env);
  return json({ success: true }, 200, { 'Set-Cookie': sessionCookie(request, token) });
}

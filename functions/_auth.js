const COOKIE_NAME = 'sarah_session';
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

const encoder = new TextEncoder();

export function getPassword(env) {
  return env.PASSWORD || 'sarah';
}

// 签名密钥由密码派生，所以改 PASSWORD 会让所有已发出的会话自动失效。
async function hmacKey(env) {
  const secret = env.SESSION_SECRET || getPassword(env);
  return crypto.subtle.importKey(
    'raw', encoder.encode('sarah-session:' + secret),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']
  );
}

function toB64url(bytes) {
  let s = '';
  for (const b of new Uint8Array(bytes)) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromB64url(str) {
  const b64 = str.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(b64 + '='.repeat((4 - b64.length % 4) % 4));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export async function createSession(env) {
  const payload = String(Date.now() + SESSION_TTL_MS);
  const sig = await crypto.subtle.sign('HMAC', await hmacKey(env), encoder.encode(payload));
  return payload + '.' + toB64url(sig);
}

export async function verifySession(env, token) {
  if (!token || typeof token !== 'string') return false;
  const dot = token.indexOf('.');
  if (dot < 1) return false;
  const payload = token.slice(0, dot);
  const exp = Number(payload);
  if (!Number.isFinite(exp) || Date.now() > exp) return false;
  try {
    return await crypto.subtle.verify(
      'HMAC', await hmacKey(env), fromB64url(token.slice(dot + 1)), encoder.encode(payload)
    );
  } catch { return false; }
}

function readCookie(request, name) {
  const header = request.headers.get('Cookie');
  if (!header) return null;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq < 0) continue;
    if (part.slice(0, eq).trim() === name) return decodeURIComponent(part.slice(eq + 1).trim());
  }
  return null;
}

export async function isAuthed(request, env) {
  return verifySession(env, readCookie(request, COOKIE_NAME));
}

function cookieAttrs(request) {
  // 本地 wrangler dev 走 http，带 Secure 会被浏览器丢掉，所以只在 https 下加。
  const secure = new URL(request.url).protocol === 'https:' ? '; Secure' : '';
  return `; Path=/; HttpOnly; SameSite=Lax${secure}`;
}

export function sessionCookie(request, token) {
  return `${COOKIE_NAME}=${encodeURIComponent(token)}; Max-Age=${Math.floor(SESSION_TTL_MS / 1000)}${cookieAttrs(request)}`;
}

export function clearCookie(request) {
  return `${COOKIE_NAME}=; Max-Age=0${cookieAttrs(request)}`;
}

// 定长比较，避免通过响应时间猜密码
export function passwordMatches(env, input) {
  const a = encoder.encode(String(input ?? ''));
  const b = encoder.encode(getPassword(env));
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

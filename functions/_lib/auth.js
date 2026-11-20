// 鉴权只有一条规则：没设 PASSWORD 就完全不设防，谁都能访问。
// 故意不设默认密码——默认密码等于把钥匙插在门上，外人一看就知道。
// 要开密码保护，用 `npx wrangler secret put PASSWORD` 设一个值即可。

export function authRequired(env) {
  return !!env.PASSWORD;
}

export function checkPassword(env, provided) {
  if (!authRequired(env)) return true;
  return provided === env.PASSWORD;
}

export function checkHeader(env, request) {
  return checkPassword(env, request.headers.get('X-Password'));
}

export function unauthorized() {
  return new Response("Unauthorized", { status: 401 });
}

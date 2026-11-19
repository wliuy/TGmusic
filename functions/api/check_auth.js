export async function onRequest(context) {
  const { request, env } = context;
  if (request.method !== 'POST') return new Response("Bad Method", { status: 405 });
  try {
    const { password } = await request.json();
    const correctPassword = env.PASSWORD || "sarah";
    return new Response(JSON.stringify({ success: password === correctPassword }), { headers: { 'Content-Type': 'application/json' } });
  } catch (err) { return new Response(JSON.stringify({ success: false }), { status: 500 }); }
}
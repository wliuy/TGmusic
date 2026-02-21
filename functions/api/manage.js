export async function onRequest(context) {
  const { request, env } = context;
  if (request.method !== 'POST') return new Response("Bad Method", { status: 405 });
  try {
    const payload = await request.json();
    const data = JSON.stringify(payload.data || payload);
    await env.DB.prepare("INSERT INTO storage (key, value) VALUES ('song_list', ?1) ON CONFLICT(key) DO UPDATE SET value = ?1")
      .bind(data)
      .run();
    return new Response(JSON.stringify({ success: true }), { headers: { 'Content-Type': 'application/json' } });
  } catch (err) { 
    return new Response(JSON.stringify({ success: false, error: err.message }), { status: 500, headers: { 'Content-Type': 'application/json' } }); 
  }
}
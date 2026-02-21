export async function onRequest(context) {
  const { request, env } = context;
  
  const PASS = env.PASSWORD;
  if (PASS) {
    const auth = request.headers.get('X-Sarah-Password');
    if (auth !== PASS) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), { 
        status: 401, 
        headers: { 'Content-Type': 'application/json' } 
      });
    }
  }

  if (request.method !== 'POST') return new Response("Bad Method", { status: 405 });
  try {
    const payload = await request.json();
    await env.MUSIC_KV.put('song_list', JSON.stringify(payload.data || payload));
    return new Response(JSON.stringify({ success: true }), { 
      headers: { 'Content-Type': 'application/json' } 
    });
  } catch (err) { 
    return new Response(err.message, { status: 500 }); 
  }
}
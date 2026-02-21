export async function onRequest(context) {
  const { env } = context;
  try {
    const result = await env.DB.prepare("SELECT value FROM storage WHERE key = 'song_list'").first();
    const stored = result ? result.value : '{"songs":[], "favorites":[], "playlists":[]}';
    return new Response(stored, { headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' } });
  } catch (err) { 
    return new Response('{"songs":[], "favorites":[], "playlists":[]}', { status: 200, headers: { 'Content-Type': 'application/json' } }); 
  }
}
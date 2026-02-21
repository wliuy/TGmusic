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

  try {
    // 移除数据库读取，返回默认初始状态
    const defaultData = { songs: [], favorites: [], playlists: [] };
    return new Response(JSON.stringify(defaultData), { 
      headers: { 
        'Content-Type': 'application/json', 
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'no-store, no-cache, must-revalidate'
      } 
    });
  } catch (err) { 
    return new Response("[]", { status: 500 }); 
  }
}
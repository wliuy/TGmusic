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
    const DB = env.DB;
    if (!DB) return new Response(JSON.stringify({ error: "D1 Not Bound" }), { status: 500 });

    // 获取按全库排序的歌曲
    const songs = (await DB.prepare("SELECT * FROM songs ORDER BY global_order ASC").all()).results;
    
    // 获取收藏列表
    const favorites = songs.filter(s => s.is_favorite === 1).map(s => s.file_id);
    
    // 获取所有歌单元数据
    const playlistRows = (await DB.prepare("SELECT * FROM playlists").all()).results;
    
    // 组装歌单及其内部关联的歌曲 (按各自的 position 排序)
    const playlists = [];
    for (const pl of playlistRows) {
      const mapping = (await DB.prepare("SELECT song_file_id FROM playlist_mapping WHERE playlist_id = ? ORDER BY position ASC").bind(pl.id).all()).results;
      playlists.push({
        id: pl.id,
        name: pl.name,
        ids: mapping.map(m => m.song_file_id)
      });
    }

    const data = { songs, favorites, playlists };
    return new Response(JSON.stringify(data), { 
      headers: { 
        'Content-Type': 'application/json', 
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'no-store, no-cache, must-revalidate'
      } 
    });
  } catch (err) { 
    return new Response(JSON.stringify({ error: err.message }), { status: 500 }); 
  }
}
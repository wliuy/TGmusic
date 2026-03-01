export async function onRequest(context) {
  const { env } = context;
  try {
    // 物理级聚合：一次数据库往返获取全部关系快照
    const batchRes = await env.DB.batch([
      env.DB.prepare("SELECT file_id, title, artist, cover FROM songs"),
      env.DB.prepare("SELECT * FROM playlist_mapping ORDER BY sort_order DESC"),
      env.DB.prepare("SELECT * FROM playlists WHERE id NOT IN ('all', 'fav')")
    ]);
    
    const [songs, mappings, playlists] = batchRes.map(r => r.results || []);
    
    const res = {
      songs: songs,
      favorites: mappings.filter(m => m.playlist_id === 'fav').map(m => m.file_id),
      playlists: playlists.sort((a, b) => (Number(b.sort_order) || 0) - (Number(a.sort_order) || 0)).map(p => ({
        id: p.id,
        name: p.name,
        ids: mappings.filter(m => m.playlist_id === p.id).map(m => m.file_id)
      })),
      all_order: mappings.filter(m => m.playlist_id === 'all').map(m => m.file_id)
    };
    return new Response(JSON.stringify(res), { headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' } });
  } catch (err) { 
    return new Response(JSON.stringify({ songs:[], favorites:[], playlists:[], all_order:[] }), { status: 200 }); 
  }
}
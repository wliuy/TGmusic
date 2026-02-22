export async function onRequest(context) {
  const { env } = context;
  try {
    const songs = await env.DB.prepare("SELECT * FROM songs").all();
    const mappings = await env.DB.prepare("SELECT * FROM playlist_mapping ORDER BY sort_order DESC").all();
    const playlists = await env.DB.prepare("SELECT * FROM playlists ORDER BY sort_order ASC").all();
    
    const res = {
      songs: songs.results || [],
      favorites: mappings.results.filter(m => m.playlist_id === 'fav').map(m => m.file_id),
      playlists: playlists.results.map(p => ({
        id: p.id,
        name: p.name,
        ids: mappings.results.filter(m => m.playlist_id === p.id).map(m => m.file_id)
      })),
      all_order: mappings.results.filter(m => m.playlist_id === 'all').map(m => m.file_id)
    };
    return new Response(JSON.stringify(res), { headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' } });
  } catch (err) { 
    return new Response(JSON.stringify({ songs:[], favorites:[], playlists:[], all_order:[] }), { status: 200 }); 
  }
}
export async function onRequest(context) {
  const { env } = context;
  try {
    const data = await env.DB.prepare(`
      SELECT s.*, GROUP_CONCAT(m.playlist_id) as p_ids 
      FROM songs s 
      LEFT JOIN playlist_mapping m ON s.file_id = m.file_id 
      GROUP BY s.file_id
    `).all();
    const playlists = await env.DB.prepare("SELECT * FROM playlists WHERE id NOT IN ('all', 'fav')").all();
    
    const results = data.results || [];
    const res = {
      songs: results,
      favorites: results.filter(s => s.p_ids?.includes('fav')).map(s => s.file_id),
      playlists: (playlists.results || []).sort((a, b) => (Number(b.sort_order) || 0) - (Number(a.sort_order) || 0)).map(p => ({
        id: p.id,
        name: p.name,
        ids: results.filter(s => s.p_ids?.includes(p.id)).map(s => s.file_id)
      })),
      all_order: results.filter(s => s.p_ids?.includes('all')).map(s => s.file_id)
    };
    return new Response(JSON.stringify(res), { headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' } });
  } catch (err) { 
    return new Response(JSON.stringify({ songs:[], favorites:[], playlists:[], all_order:[] }), { status: 200 }); 
  }
}
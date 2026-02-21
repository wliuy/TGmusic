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
    const DB = env.DB;
    const payload = await request.json();
    const { songs, favorites, playlists } = payload.data || payload;

    const statements = [];
    
    // 1. 同步歌曲主表与全局顺序
    statements.push(DB.prepare("DELETE FROM songs"));
    songs.forEach((s, idx) => {
      const isFav = favorites.includes(s.file_id) ? 1 : 0;
      statements.push(DB.prepare("INSERT INTO songs (file_id, title, artist, cover, lrc, is_favorite, global_order) VALUES (?, ?, ?, ?, ?, ?, ?)")
        .bind(s.file_id, s.title, s.artist, s.cover, s.lrc, isFav, idx));
    });

    // 2. 同步歌单表及其独立排序映射
    statements.push(DB.prepare("DELETE FROM playlists"));
    statements.push(DB.prepare("DELETE FROM playlist_mapping"));
    
    for (let i = 0; i < playlists.length; i++) {
      const pl = playlists[i];
      const plId = i + 1;
      statements.push(DB.prepare("INSERT INTO playlists (id, name) VALUES (?, ?)")
        .bind(plId, pl.name));
      
      pl.ids.forEach((sid, pos) => {
        statements.push(DB.prepare("INSERT INTO playlist_mapping (playlist_id, song_file_id, position) VALUES (?, ?, ?)")
          .bind(plId, sid, pos));
      });
    }

    await DB.batch(statements);

    return new Response(JSON.stringify({ success: true }), { 
      headers: { 'Content-Type': 'application/json' } 
    });
  } catch (err) { 
    return new Response(err.message, { status: 500 }); 
  }
}
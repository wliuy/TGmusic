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

  const DB = env.DB;
  const url = new URL(request.url);
  const action = url.searchParams.get('action');
  try {
    await DB.batch([
      DB.prepare("CREATE TABLE IF NOT EXISTS songs (file_id TEXT PRIMARY KEY, title TEXT, artist TEXT, cover TEXT, lrc TEXT, created_at DATETIME DEFAULT CURRENT_TIMESTAMP)"),
      DB.prepare("CREATE TABLE IF NOT EXISTS playlists (id TEXT PRIMARY KEY, name TEXT)"),
      DB.prepare("CREATE TABLE IF NOT EXISTS playlist_songs (playlist_id TEXT, file_id TEXT, sort_order INTEGER, PRIMARY KEY(playlist_id, file_id))")
    ]);
    if (request.method === 'GET') {
      if (action === 'init') {
        const songs = await DB.prepare("SELECT * FROM songs").all();
        const playlists = await DB.prepare("SELECT * FROM playlists").all();
        const mappings = await DB.prepare("SELECT * FROM playlist_songs ORDER BY sort_order ASC").all();
        return new Response(JSON.stringify({ songs: songs.results, playlists: playlists.results, mappings: mappings.results }), { headers: { 'Content-Type': 'application/json' } });
      }
    } else if (request.method === 'POST') {
      const body = await request.json();
      if (action === 'save_playlist') {
        await DB.prepare("INSERT OR REPLACE INTO playlists (id, name) VALUES (?, ?)").bind(body.id, body.name).run();
      } else if (action === 'del_playlist') {
        await DB.batch([
          DB.prepare("DELETE FROM playlists WHERE id = ?").bind(body.id),
          DB.prepare("DELETE FROM playlist_songs WHERE playlist_id = ?").bind(body.id)
        ]);
      } else if (action === 'update_order') {
        const { playlist_id, ids } = body;
        const statements = ids.map((id, index) => DB.prepare("INSERT OR REPLACE INTO playlist_songs (playlist_id, file_id, sort_order) VALUES (?, ?, ?)").bind(playlist_id, id, index));
        await DB.batch(statements);
      } else if (action === 'update_song') {
        await DB.prepare("UPDATE songs SET title = ?, artist = ? WHERE file_id = ?").bind(body.title, body.artist, body.file_id).run();
      } else if (action === 'del_song') {
        await DB.batch([
          DB.prepare("DELETE FROM songs WHERE file_id = ?").bind(body.file_id),
          DB.prepare("DELETE FROM playlist_songs WHERE file_id = ?").bind(body.file_id)
        ]);
      } else if (action === 'toggle_mapping') {
        const { playlist_id, file_id, active } = body;
        if (active) {
          await DB.prepare("INSERT OR IGNORE INTO playlist_songs (playlist_id, file_id, sort_order) VALUES (?, ?, (SELECT IFNULL(MAX(sort_order), 0) + 1 FROM playlist_songs WHERE playlist_id = ?))").bind(playlist_id, file_id, playlist_id).run();
        } else {
          await DB.prepare("DELETE FROM playlist_songs WHERE playlist_id = ? AND file_id = ?").bind(playlist_id, file_id).run();
        }
      }
      return new Response(JSON.stringify({ success: true }), { headers: { 'Content-Type': 'application/json' } });
    }
  } catch (err) { return new Response(err.message, { status: 500 }); }
}
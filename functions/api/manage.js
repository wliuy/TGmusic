export async function onRequest(context) {
  const { request, env } = context;
  if (request.method !== 'POST') return new Response("Bad Method", { status: 405 });
  try {
    const { action, data } = await request.json();
    if (action === 'update_song') {
      await env.DB.prepare("UPDATE songs SET title = ?1, artist = ?2 WHERE file_id = ?3").bind(data.title, data.artist, data.file_id).run();
    } else if (action === 'delete_song') {
      if (data.playlist_id === 'all') {
        await env.DB.prepare("DELETE FROM songs WHERE file_id = ?").bind(data.file_id).run();
        await env.DB.prepare("DELETE FROM playlist_mapping WHERE file_id = ?").bind(data.file_id).run();
      } else {
        await env.DB.prepare("DELETE FROM playlist_mapping WHERE playlist_id = ? AND file_id = ?").bind(data.playlist_id, data.file_id).run();
      }
    } else if (action === 'toggle_fav') {
      const exist = await env.DB.prepare("SELECT 1 FROM playlist_mapping WHERE playlist_id = 'fav' AND file_id = ?").bind(data.file_id).first();
      if (exist) await env.DB.prepare("DELETE FROM playlist_mapping WHERE playlist_id = 'fav' AND file_id = ?").bind(data.file_id).run();
      else await env.DB.prepare("INSERT INTO playlist_mapping (playlist_id, file_id, sort_order) VALUES ('fav', ?, ?)")
          .bind(data.file_id, Date.now()).run();
    } else if (action === 'add_playlist') {
      await env.DB.prepare("INSERT INTO playlists (id, name, created_at) VALUES (?, ?, ?)").bind(crypto.randomUUID(), data.name, Date.now()).run();
    } else if (action === 'rename_playlist') {
      await env.DB.prepare("UPDATE playlists SET name = ? WHERE id = ?").bind(data.name, data.id).run();
    } else if (action === 'delete_playlist') {
      await env.DB.prepare("DELETE FROM playlists WHERE id = ?").bind(data.id).run();
      await env.DB.prepare("DELETE FROM playlist_mapping WHERE file_id = ?").bind(data.id).run();
    } else if (action === 'add_to_playlist') {
      await env.DB.prepare("INSERT OR IGNORE INTO playlist_mapping (playlist_id, file_id, sort_order) VALUES (?, ?, ?)")
        .bind(data.playlist_id, data.file_id, Date.now()).run();
    } else if (action === 'update_order') {
      const { playlist_id, ids } = data;
      const statements = ids.map((fid, idx) => 
        env.DB.prepare("INSERT INTO playlist_mapping (playlist_id, file_id, sort_order) VALUES (?1, ?2, ?3) ON CONFLICT(playlist_id, file_id) DO UPDATE SET sort_order = ?3")
          .bind(playlist_id, fid, ids.length - idx)
      );
      await env.DB.batch(statements);
    } else if (action === 'update_playlist_order') {
      const { ids } = data;
      const statements = ids.map((pid, idx) => 
        env.DB.prepare("UPDATE playlists SET created_at = ? WHERE id = ?").bind(idx, pid)
      );
      await env.DB.batch(statements);
    } else if (action === 'get_logs') {
      const logs = await env.DB.prepare("SELECT * FROM upload_logs ORDER BY timestamp DESC LIMIT 50").all();
      return new Response(JSON.stringify({ success: true, logs: logs.results || [] }));
    } else if (action === 'clear_logs') {
      await env.DB.prepare("DELETE FROM upload_logs").run();
    }
    return new Response(JSON.stringify({ success: true }));
  } catch (err) { return new Response(JSON.stringify({ success: false, error: err.message }), { status: 500 }); }
}
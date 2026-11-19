import { isAuthed } from '../_auth.js';

const SCHEMA = [
  "CREATE TABLE IF NOT EXISTS songs (file_id TEXT PRIMARY KEY, title TEXT, artist TEXT, cover TEXT, lrc TEXT)",
  "CREATE TABLE IF NOT EXISTS playlists (id TEXT PRIMARY KEY, name TEXT, sort_order INTEGER)",
  "CREATE TABLE IF NOT EXISTS playlist_mapping (playlist_id TEXT, file_id TEXT, sort_order INTEGER, PRIMARY KEY(playlist_id, file_id))",
  "CREATE TABLE IF NOT EXISTS upload_logs (id INTEGER PRIMARY KEY AUTOINCREMENT, filename TEXT, status TEXT, reason TEXT, timestamp DATETIME DEFAULT CURRENT_TIMESTAMP)"
];

async function readLibrary(env) {
  const songs = await env.DB.prepare("SELECT file_id, title, artist, cover FROM songs").all();
  const mappings = await env.DB.prepare("SELECT * FROM playlist_mapping ORDER BY sort_order DESC").all();
  const playlists = await env.DB.prepare("SELECT * FROM playlists WHERE id NOT IN ('all', 'fav')").all();

  return {
    songs: songs.results || [],
    favorites: mappings.results.filter(m => m.playlist_id === 'fav').map(m => m.file_id),
    playlists: (playlists.results || []).sort((a, b) => (Number(b.sort_order) || 0) - (Number(a.sort_order) || 0)).map(p => ({
      id: p.id,
      name: p.name,
      ids: mappings.results.filter(m => m.playlist_id === p.id).map(m => m.file_id)
    })),
    all_order: mappings.results.filter(m => m.playlist_id === 'all').map(m => m.file_id)
  };
}

export async function onRequest(context) {
  const { request, env } = context;
  if (!(await isAuthed(request, env))) return new Response("Unauthorized", { status: 401 });
  try {
    let res;
    try {
      res = await readLibrary(env);
    } catch (err) {
      // 首次部署时表还不存在，建表后重试一次，避免新库一打开就是空白
      if (!/no such table/i.test(err.message || '')) throw err;
      await env.DB.batch(SCHEMA.map(sql => env.DB.prepare(sql)));
      res = await readLibrary(env);
    }
    return new Response(JSON.stringify(res), { headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' } });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message || 'D1 Error' }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
}

export async function onRequest(context) {
  const { env } = context;
  return new Response(JSON.stringify({ title: env.SITE_TITLE || 'TGmusic' }), {
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
    },
  });
}

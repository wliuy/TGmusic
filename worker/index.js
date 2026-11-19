import { onRequest as checkAuth } from '../functions/api/check_auth.js';
import { onRequest as manage } from '../functions/api/manage.js';
import { onRequest as songs } from '../functions/api/songs.js';
import { onRequest as stream } from '../functions/api/stream.js';
import { onRequest as upload } from '../functions/api/upload.js';

const ROUTES = {
  '/api/check_auth': checkAuth,
  '/api/manage': manage,
  '/api/songs': songs,
  '/api/stream': stream,
  '/api/upload': upload,
};

export default {
  async fetch(request, env, ctx) {
    const { pathname } = new URL(request.url);
    const handler = ROUTES[pathname];
    if (handler) return handler({ request, env, ctx });
    return env.ASSETS.fetch(request);
  },
};

import { onRequest as __api_check_auth_js_onRequest } from "D:\\UserData\\ayang\\Desktop\\Git\\TGmusic\\functions\\api\\check_auth.js"
import { onRequest as __api_manage_js_onRequest } from "D:\\UserData\\ayang\\Desktop\\Git\\TGmusic\\functions\\api\\manage.js"
import { onRequest as __api_songs_js_onRequest } from "D:\\UserData\\ayang\\Desktop\\Git\\TGmusic\\functions\\api\\songs.js"
import { onRequest as __api_stream_js_onRequest } from "D:\\UserData\\ayang\\Desktop\\Git\\TGmusic\\functions\\api\\stream.js"
import { onRequest as __api_upload_js_onRequest } from "D:\\UserData\\ayang\\Desktop\\Git\\TGmusic\\functions\\api\\upload.js"

export const routes = [
    {
      routePath: "/api/check_auth",
      mountPath: "/api",
      method: "",
      middlewares: [],
      modules: [__api_check_auth_js_onRequest],
    },
  {
      routePath: "/api/manage",
      mountPath: "/api",
      method: "",
      middlewares: [],
      modules: [__api_manage_js_onRequest],
    },
  {
      routePath: "/api/songs",
      mountPath: "/api",
      method: "",
      middlewares: [],
      modules: [__api_songs_js_onRequest],
    },
  {
      routePath: "/api/stream",
      mountPath: "/api",
      method: "",
      middlewares: [],
      modules: [__api_stream_js_onRequest],
    },
  {
      routePath: "/api/upload",
      mountPath: "/api",
      method: "",
      middlewares: [],
      modules: [__api_upload_js_onRequest],
    },
  ]
var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });

// api/check_auth.js
async function onRequest(context) {
  const { request, env } = context;
  if (request.method !== "POST") return new Response("Bad Method", { status: 405 });
  try {
    const { password } = await request.json();
    const correctPassword = env.PASSWORD || "sarah";
    return new Response(JSON.stringify({ success: password === correctPassword }), { headers: { "Content-Type": "application/json" } });
  } catch (err) {
    return new Response(JSON.stringify({ success: false }), { status: 500 });
  }
}
__name(onRequest, "onRequest");

// api/manage.js
async function onRequest2(context) {
  const { request, env } = context;
  if (request.method !== "POST") return new Response("Bad Method", { status: 405 });
  try {
    await env.DB.prepare("CREATE TABLE IF NOT EXISTS songs (file_id TEXT PRIMARY KEY, title TEXT, artist TEXT, cover TEXT, lrc TEXT)").run();
    await env.DB.prepare("CREATE TABLE IF NOT EXISTS playlists (id TEXT PRIMARY KEY, name TEXT, sort_order INTEGER)").run();
    await env.DB.prepare("CREATE TABLE IF NOT EXISTS playlist_mapping (playlist_id TEXT, file_id TEXT, sort_order INTEGER, PRIMARY KEY(playlist_id, file_id))").run();
    const { action, data } = await request.json();
    if (action === "get_lrc") {
      const song = await env.DB.prepare("SELECT lrc FROM songs WHERE file_id = ?").bind(data.file_id).first();
      return new Response(JSON.stringify({ success: true, lrc: song?.lrc || "" }));
    } else if (action === "update_song") {
      await env.DB.prepare("UPDATE songs SET title = ?1, artist = ?2 WHERE file_id = ?3").bind(data.title, data.artist, data.file_id).run();
    } else if (action === "delete_song") {
      if (data.playlist_id === "all") {
        await env.DB.prepare("DELETE FROM songs WHERE file_id = ?").bind(data.file_id).run();
        await env.DB.prepare("DELETE FROM playlist_mapping WHERE file_id = ?").bind(data.file_id).run();
      } else {
        await env.DB.prepare("DELETE FROM playlist_mapping WHERE playlist_id = ? AND file_id = ?").bind(data.playlist_id, data.file_id).run();
      }
    } else if (action === "toggle_fav") {
      const exist = await env.DB.prepare("SELECT 1 FROM playlist_mapping WHERE playlist_id = 'fav' AND file_id = ?").bind(data.file_id).first();
      if (exist) await env.DB.prepare("DELETE FROM playlist_mapping WHERE playlist_id = 'fav' AND file_id = ?").bind(data.file_id).run();
      else await env.DB.prepare("INSERT INTO playlist_mapping (playlist_id, file_id, sort_order) VALUES ('fav', ?, ?)").bind(data.file_id, Date.now()).run();
    } else if (action === "add_playlist") {
      await env.DB.prepare("INSERT INTO playlists (id, name, sort_order) VALUES (?, ?, ?)").bind(crypto.randomUUID(), data.name, Date.now()).run();
    } else if (action === "rename_playlist") {
      await env.DB.prepare("UPDATE playlists SET name = ? WHERE id = ?").bind(data.name, data.id).run();
    } else if (action === "delete_playlist") {
      await env.DB.prepare("DELETE FROM playlists WHERE id = ?").bind(data.id).run();
      await env.DB.prepare("DELETE FROM playlist_mapping WHERE file_id = ?").bind(data.id).run();
    } else if (action === "add_to_playlist") {
      await env.DB.prepare("INSERT OR IGNORE INTO playlist_mapping (playlist_id, file_id, sort_order) VALUES (?, ?, ?)").bind(data.playlist_id, data.file_id, Date.now()).run();
    } else if (action === "update_order") {
      const { playlist_id, ids } = data;
      const statements = ids.map(
        (fid, idx) => env.DB.prepare("INSERT INTO playlist_mapping (playlist_id, file_id, sort_order) VALUES (?1, ?2, ?3) ON CONFLICT(playlist_id, file_id) DO UPDATE SET sort_order = ?3").bind(playlist_id, fid, ids.length - idx)
      );
      await env.DB.batch(statements);
    } else if (action === "update_playlist_order") {
      const { ids } = data;
      const statements = ids.map(
        (pid, idx) => env.DB.prepare("UPDATE playlists SET sort_order = ?1 WHERE id = ?2").bind(ids.length - idx, pid)
      );
      try {
        await env.DB.batch(statements);
      } catch (e) {
        console.error("Persistence failed: " + e.message);
      }
    } else if (action === "get_logs") {
      const logs = await env.DB.prepare("SELECT * FROM upload_logs ORDER BY timestamp DESC LIMIT 50").all();
      return new Response(JSON.stringify({ success: true, logs: logs.results || [] }));
    } else if (action === "clear_logs") {
      await env.DB.prepare("DELETE FROM upload_logs").run();
    }
    return new Response(JSON.stringify({ success: true }));
  } catch (err) {
    return new Response(JSON.stringify({ success: false, error: err.message }), { status: 500 });
  }
}
__name(onRequest2, "onRequest");

// api/songs.js
async function onRequest3(context) {
  const { env } = context;
  try {
    const songs = await env.DB.prepare("SELECT file_id, title, artist, cover FROM songs").all();
    const mappings = await env.DB.prepare("SELECT * FROM playlist_mapping ORDER BY sort_order DESC").all();
    const playlists = await env.DB.prepare("SELECT * FROM playlists WHERE id NOT IN ('all', 'fav')").all();
    const res = {
      songs: songs.results || [],
      favorites: mappings.results.filter((m) => m.playlist_id === "fav").map((m) => m.file_id),
      playlists: (playlists.results || []).sort((a, b) => (Number(b.sort_order) || 0) - (Number(a.sort_order) || 0)).map((p) => ({
        id: p.id,
        name: p.name,
        ids: mappings.results.filter((m) => m.playlist_id === p.id).map((m) => m.file_id)
      })),
      all_order: mappings.results.filter((m) => m.playlist_id === "all").map((m) => m.file_id)
    };
    return new Response(JSON.stringify(res), { headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" } });
  } catch (err) {
    return new Response(JSON.stringify({ songs: [], favorites: [], playlists: [], all_order: [] }), { status: 200 });
  }
}
__name(onRequest3, "onRequest");

// api/stream.js
var urlCache = /* @__PURE__ */ new Map();
async function onRequest4(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const fileId = url.searchParams.get("file_id");
  const BOT_TOKEN = env.TG_Bot_Token;
  if (!fileId || !BOT_TOKEN) return new Response("Params error", { status: 400 });
  try {
    let cacheItem = urlCache.get(fileId);
    let downloadUrl = "";
    if (cacheItem && Date.now() < cacheItem.expiry) {
      downloadUrl = cacheItem.url;
    } else {
      const getFileUrl = "https://api.telegram.org/bot" + BOT_TOKEN + "/getFile?file_id=" + fileId;
      const fileInfo = await (await fetch(getFileUrl)).json();
      if (!fileInfo.ok) return new Response("TG API Fault", { status: 400 });
      downloadUrl = "https://api.telegram.org/file/bot" + BOT_TOKEN + "/" + fileInfo.result.file_path;
      urlCache.set(fileId, { url: downloadUrl, expiry: Date.now() + 18e5 });
    }
    const range = request.headers.get("Range");
    const fileRes = await fetch(downloadUrl, { headers: range ? { "Range": range } : {} });
    const headers = new Headers(fileRes.headers);
    headers.set("Access-Control-Allow-Origin", "*");
    headers.set("Cache-Control", "public, max-age=31536000");
    if (!headers.has("Content-Type")) {
      headers.set("Content-Type", downloadUrl.toLowerCase().endsWith(".flac") ? "audio/flac" : "audio/mpeg");
    }
    return new Response(fileRes.body, { status: fileRes.status, headers });
  } catch (err) {
    return new Response("Service Error", { status: 500 });
  }
}
__name(onRequest4, "onRequest");

// api/upload.js
async function onRequest5(context) {
  const { request, env } = context;
  const BOT_TOKEN = env.TG_Bot_Token;
  const CHAT_ID = env.TG_Chat_ID;
  await env.DB.prepare("CREATE TABLE IF NOT EXISTS upload_logs (id INTEGER PRIMARY KEY AUTOINCREMENT, filename TEXT, status TEXT, reason TEXT, timestamp DATETIME DEFAULT CURRENT_TIMESTAMP)").run();
  let filename = "Unknown";
  try {
    const formData = await request.formData();
    const audioFile = formData.get("file");
    const coverFile = formData.get("cover");
    const targetPlaylist = formData.get("target_playlist");
    filename = audioFile.name || "Unknown";
    const meta = JSON.parse(formData.get("meta") || "{}");
    let finalCoverUrl = "";
    if (coverFile) {
      const imgFormData = new FormData();
      imgFormData.append("chat_id", CHAT_ID);
      imgFormData.append("photo", coverFile);
      const imgRes = await fetch("https://api.telegram.org/bot" + BOT_TOKEN + "/sendPhoto", { method: "POST", body: imgFormData });
      const imgData = await imgRes.json();
      if (imgData.ok) {
        const photoArr = imgData.result.photo;
        const bestFid = photoArr[photoArr.length - 1].file_id;
        finalCoverUrl = "/api/stream?file_id=" + bestFid;
      }
    }
    const tgFormData = new FormData();
    tgFormData.append("chat_id", CHAT_ID);
    tgFormData.append("audio", audioFile);
    const tgRes = await fetch("https://api.telegram.org/bot" + BOT_TOKEN + "/sendAudio", { method: "POST", body: tgFormData });
    const result = await tgRes.json();
    if (!result.ok) {
      const errorMsg = result.description || "Telegram API Error";
      await env.DB.prepare("INSERT INTO upload_logs (filename, status, reason) VALUES (?, 'FAIL', ?)").bind(filename, errorMsg).run();
      return new Response(JSON.stringify({ success: false, error: errorMsg }), { status: 400 });
    }
    const fid = result.result.audio.file_id;
    await env.DB.prepare("INSERT INTO songs (file_id, title, artist, cover, lrc) VALUES (?1, ?2, ?3, ?4, ?5)").bind(fid, meta.title || "\u672A\u77E5", meta.artist || "\u672A\u77E5", finalCoverUrl, meta.lrc || "").run();
    await env.DB.prepare("INSERT INTO playlist_mapping (playlist_id, file_id, sort_order) VALUES ('all', ?, ?)").bind(fid, Date.now()).run();
    if (targetPlaylist) {
      await env.DB.prepare("INSERT OR IGNORE INTO playlist_mapping (playlist_id, file_id, sort_order) VALUES (?, ?, ?)").bind(targetPlaylist, fid, Date.now()).run();
    }
    await env.DB.prepare("INSERT INTO upload_logs (filename, status, reason) VALUES (?, 'SUCCESS', 'OK')").bind(filename).run();
    return new Response(JSON.stringify({ success: true, file_id: fid }));
  } catch (err) {
    await env.DB.prepare("INSERT INTO upload_logs (filename, status, reason) VALUES (?, 'FAIL', ?)").bind(filename, err.message).run();
    return new Response(JSON.stringify({ success: false, error: err.message }), { status: 500 });
  }
}
__name(onRequest5, "onRequest");

// ../.wrangler/tmp/pages-SRpT1y/functionsRoutes-0.7024911237428865.mjs
var routes = [
  {
    routePath: "/api/check_auth",
    mountPath: "/api",
    method: "",
    middlewares: [],
    modules: [onRequest]
  },
  {
    routePath: "/api/manage",
    mountPath: "/api",
    method: "",
    middlewares: [],
    modules: [onRequest2]
  },
  {
    routePath: "/api/songs",
    mountPath: "/api",
    method: "",
    middlewares: [],
    modules: [onRequest3]
  },
  {
    routePath: "/api/stream",
    mountPath: "/api",
    method: "",
    middlewares: [],
    modules: [onRequest4]
  },
  {
    routePath: "/api/upload",
    mountPath: "/api",
    method: "",
    middlewares: [],
    modules: [onRequest5]
  }
];

// ../node_modules/path-to-regexp/dist.es2015/index.js
function lexer(str) {
  var tokens = [];
  var i = 0;
  while (i < str.length) {
    var char = str[i];
    if (char === "*" || char === "+" || char === "?") {
      tokens.push({ type: "MODIFIER", index: i, value: str[i++] });
      continue;
    }
    if (char === "\\") {
      tokens.push({ type: "ESCAPED_CHAR", index: i++, value: str[i++] });
      continue;
    }
    if (char === "{") {
      tokens.push({ type: "OPEN", index: i, value: str[i++] });
      continue;
    }
    if (char === "}") {
      tokens.push({ type: "CLOSE", index: i, value: str[i++] });
      continue;
    }
    if (char === ":") {
      var name = "";
      var j = i + 1;
      while (j < str.length) {
        var code = str.charCodeAt(j);
        if (
          // `0-9`
          code >= 48 && code <= 57 || // `A-Z`
          code >= 65 && code <= 90 || // `a-z`
          code >= 97 && code <= 122 || // `_`
          code === 95
        ) {
          name += str[j++];
          continue;
        }
        break;
      }
      if (!name)
        throw new TypeError("Missing parameter name at ".concat(i));
      tokens.push({ type: "NAME", index: i, value: name });
      i = j;
      continue;
    }
    if (char === "(") {
      var count = 1;
      var pattern = "";
      var j = i + 1;
      if (str[j] === "?") {
        throw new TypeError('Pattern cannot start with "?" at '.concat(j));
      }
      while (j < str.length) {
        if (str[j] === "\\") {
          pattern += str[j++] + str[j++];
          continue;
        }
        if (str[j] === ")") {
          count--;
          if (count === 0) {
            j++;
            break;
          }
        } else if (str[j] === "(") {
          count++;
          if (str[j + 1] !== "?") {
            throw new TypeError("Capturing groups are not allowed at ".concat(j));
          }
        }
        pattern += str[j++];
      }
      if (count)
        throw new TypeError("Unbalanced pattern at ".concat(i));
      if (!pattern)
        throw new TypeError("Missing pattern at ".concat(i));
      tokens.push({ type: "PATTERN", index: i, value: pattern });
      i = j;
      continue;
    }
    tokens.push({ type: "CHAR", index: i, value: str[i++] });
  }
  tokens.push({ type: "END", index: i, value: "" });
  return tokens;
}
__name(lexer, "lexer");
function parse(str, options) {
  if (options === void 0) {
    options = {};
  }
  var tokens = lexer(str);
  var _a = options.prefixes, prefixes = _a === void 0 ? "./" : _a, _b = options.delimiter, delimiter = _b === void 0 ? "/#?" : _b;
  var result = [];
  var key = 0;
  var i = 0;
  var path = "";
  var tryConsume = /* @__PURE__ */ __name(function(type) {
    if (i < tokens.length && tokens[i].type === type)
      return tokens[i++].value;
  }, "tryConsume");
  var mustConsume = /* @__PURE__ */ __name(function(type) {
    var value2 = tryConsume(type);
    if (value2 !== void 0)
      return value2;
    var _a2 = tokens[i], nextType = _a2.type, index = _a2.index;
    throw new TypeError("Unexpected ".concat(nextType, " at ").concat(index, ", expected ").concat(type));
  }, "mustConsume");
  var consumeText = /* @__PURE__ */ __name(function() {
    var result2 = "";
    var value2;
    while (value2 = tryConsume("CHAR") || tryConsume("ESCAPED_CHAR")) {
      result2 += value2;
    }
    return result2;
  }, "consumeText");
  var isSafe = /* @__PURE__ */ __name(function(value2) {
    for (var _i = 0, delimiter_1 = delimiter; _i < delimiter_1.length; _i++) {
      var char2 = delimiter_1[_i];
      if (value2.indexOf(char2) > -1)
        return true;
    }
    return false;
  }, "isSafe");
  var safePattern = /* @__PURE__ */ __name(function(prefix2) {
    var prev = result[result.length - 1];
    var prevText = prefix2 || (prev && typeof prev === "string" ? prev : "");
    if (prev && !prevText) {
      throw new TypeError('Must have text between two parameters, missing text after "'.concat(prev.name, '"'));
    }
    if (!prevText || isSafe(prevText))
      return "[^".concat(escapeString(delimiter), "]+?");
    return "(?:(?!".concat(escapeString(prevText), ")[^").concat(escapeString(delimiter), "])+?");
  }, "safePattern");
  while (i < tokens.length) {
    var char = tryConsume("CHAR");
    var name = tryConsume("NAME");
    var pattern = tryConsume("PATTERN");
    if (name || pattern) {
      var prefix = char || "";
      if (prefixes.indexOf(prefix) === -1) {
        path += prefix;
        prefix = "";
      }
      if (path) {
        result.push(path);
        path = "";
      }
      result.push({
        name: name || key++,
        prefix,
        suffix: "",
        pattern: pattern || safePattern(prefix),
        modifier: tryConsume("MODIFIER") || ""
      });
      continue;
    }
    var value = char || tryConsume("ESCAPED_CHAR");
    if (value) {
      path += value;
      continue;
    }
    if (path) {
      result.push(path);
      path = "";
    }
    var open = tryConsume("OPEN");
    if (open) {
      var prefix = consumeText();
      var name_1 = tryConsume("NAME") || "";
      var pattern_1 = tryConsume("PATTERN") || "";
      var suffix = consumeText();
      mustConsume("CLOSE");
      result.push({
        name: name_1 || (pattern_1 ? key++ : ""),
        pattern: name_1 && !pattern_1 ? safePattern(prefix) : pattern_1,
        prefix,
        suffix,
        modifier: tryConsume("MODIFIER") || ""
      });
      continue;
    }
    mustConsume("END");
  }
  return result;
}
__name(parse, "parse");
function match(str, options) {
  var keys = [];
  var re = pathToRegexp(str, keys, options);
  return regexpToFunction(re, keys, options);
}
__name(match, "match");
function regexpToFunction(re, keys, options) {
  if (options === void 0) {
    options = {};
  }
  var _a = options.decode, decode = _a === void 0 ? function(x) {
    return x;
  } : _a;
  return function(pathname) {
    var m = re.exec(pathname);
    if (!m)
      return false;
    var path = m[0], index = m.index;
    var params = /* @__PURE__ */ Object.create(null);
    var _loop_1 = /* @__PURE__ */ __name(function(i2) {
      if (m[i2] === void 0)
        return "continue";
      var key = keys[i2 - 1];
      if (key.modifier === "*" || key.modifier === "+") {
        params[key.name] = m[i2].split(key.prefix + key.suffix).map(function(value) {
          return decode(value, key);
        });
      } else {
        params[key.name] = decode(m[i2], key);
      }
    }, "_loop_1");
    for (var i = 1; i < m.length; i++) {
      _loop_1(i);
    }
    return { path, index, params };
  };
}
__name(regexpToFunction, "regexpToFunction");
function escapeString(str) {
  return str.replace(/([.+*?=^!:${}()[\]|/\\])/g, "\\$1");
}
__name(escapeString, "escapeString");
function flags(options) {
  return options && options.sensitive ? "" : "i";
}
__name(flags, "flags");
function regexpToRegexp(path, keys) {
  if (!keys)
    return path;
  var groupsRegex = /\((?:\?<(.*?)>)?(?!\?)/g;
  var index = 0;
  var execResult = groupsRegex.exec(path.source);
  while (execResult) {
    keys.push({
      // Use parenthesized substring match if available, index otherwise
      name: execResult[1] || index++,
      prefix: "",
      suffix: "",
      modifier: "",
      pattern: ""
    });
    execResult = groupsRegex.exec(path.source);
  }
  return path;
}
__name(regexpToRegexp, "regexpToRegexp");
function arrayToRegexp(paths, keys, options) {
  var parts = paths.map(function(path) {
    return pathToRegexp(path, keys, options).source;
  });
  return new RegExp("(?:".concat(parts.join("|"), ")"), flags(options));
}
__name(arrayToRegexp, "arrayToRegexp");
function stringToRegexp(path, keys, options) {
  return tokensToRegexp(parse(path, options), keys, options);
}
__name(stringToRegexp, "stringToRegexp");
function tokensToRegexp(tokens, keys, options) {
  if (options === void 0) {
    options = {};
  }
  var _a = options.strict, strict = _a === void 0 ? false : _a, _b = options.start, start = _b === void 0 ? true : _b, _c = options.end, end = _c === void 0 ? true : _c, _d = options.encode, encode = _d === void 0 ? function(x) {
    return x;
  } : _d, _e = options.delimiter, delimiter = _e === void 0 ? "/#?" : _e, _f = options.endsWith, endsWith = _f === void 0 ? "" : _f;
  var endsWithRe = "[".concat(escapeString(endsWith), "]|$");
  var delimiterRe = "[".concat(escapeString(delimiter), "]");
  var route = start ? "^" : "";
  for (var _i = 0, tokens_1 = tokens; _i < tokens_1.length; _i++) {
    var token = tokens_1[_i];
    if (typeof token === "string") {
      route += escapeString(encode(token));
    } else {
      var prefix = escapeString(encode(token.prefix));
      var suffix = escapeString(encode(token.suffix));
      if (token.pattern) {
        if (keys)
          keys.push(token);
        if (prefix || suffix) {
          if (token.modifier === "+" || token.modifier === "*") {
            var mod = token.modifier === "*" ? "?" : "";
            route += "(?:".concat(prefix, "((?:").concat(token.pattern, ")(?:").concat(suffix).concat(prefix, "(?:").concat(token.pattern, "))*)").concat(suffix, ")").concat(mod);
          } else {
            route += "(?:".concat(prefix, "(").concat(token.pattern, ")").concat(suffix, ")").concat(token.modifier);
          }
        } else {
          if (token.modifier === "+" || token.modifier === "*") {
            throw new TypeError('Can not repeat "'.concat(token.name, '" without a prefix and suffix'));
          }
          route += "(".concat(token.pattern, ")").concat(token.modifier);
        }
      } else {
        route += "(?:".concat(prefix).concat(suffix, ")").concat(token.modifier);
      }
    }
  }
  if (end) {
    if (!strict)
      route += "".concat(delimiterRe, "?");
    route += !options.endsWith ? "$" : "(?=".concat(endsWithRe, ")");
  } else {
    var endToken = tokens[tokens.length - 1];
    var isEndDelimited = typeof endToken === "string" ? delimiterRe.indexOf(endToken[endToken.length - 1]) > -1 : endToken === void 0;
    if (!strict) {
      route += "(?:".concat(delimiterRe, "(?=").concat(endsWithRe, "))?");
    }
    if (!isEndDelimited) {
      route += "(?=".concat(delimiterRe, "|").concat(endsWithRe, ")");
    }
  }
  return new RegExp(route, flags(options));
}
__name(tokensToRegexp, "tokensToRegexp");
function pathToRegexp(path, keys, options) {
  if (path instanceof RegExp)
    return regexpToRegexp(path, keys);
  if (Array.isArray(path))
    return arrayToRegexp(path, keys, options);
  return stringToRegexp(path, keys, options);
}
__name(pathToRegexp, "pathToRegexp");

// ../node_modules/wrangler/templates/pages-template-worker.ts
var escapeRegex = /[.+?^${}()|[\]\\]/g;
function* executeRequest(request) {
  const requestPath = new URL(request.url).pathname;
  for (const route of [...routes].reverse()) {
    if (route.method && route.method !== request.method) {
      continue;
    }
    const routeMatcher = match(route.routePath.replace(escapeRegex, "\\$&"), {
      end: false
    });
    const mountMatcher = match(route.mountPath.replace(escapeRegex, "\\$&"), {
      end: false
    });
    const matchResult = routeMatcher(requestPath);
    const mountMatchResult = mountMatcher(requestPath);
    if (matchResult && mountMatchResult) {
      for (const handler of route.middlewares.flat()) {
        yield {
          handler,
          params: matchResult.params,
          path: mountMatchResult.path
        };
      }
    }
  }
  for (const route of routes) {
    if (route.method && route.method !== request.method) {
      continue;
    }
    const routeMatcher = match(route.routePath.replace(escapeRegex, "\\$&"), {
      end: true
    });
    const mountMatcher = match(route.mountPath.replace(escapeRegex, "\\$&"), {
      end: false
    });
    const matchResult = routeMatcher(requestPath);
    const mountMatchResult = mountMatcher(requestPath);
    if (matchResult && mountMatchResult && route.modules.length) {
      for (const handler of route.modules.flat()) {
        yield {
          handler,
          params: matchResult.params,
          path: matchResult.path
        };
      }
      break;
    }
  }
}
__name(executeRequest, "executeRequest");
var pages_template_worker_default = {
  async fetch(originalRequest, env, workerContext) {
    let request = originalRequest;
    const handlerIterator = executeRequest(request);
    let data = {};
    let isFailOpen = false;
    const next = /* @__PURE__ */ __name(async (input, init) => {
      if (input !== void 0) {
        let url = input;
        if (typeof input === "string") {
          url = new URL(input, request.url).toString();
        }
        request = new Request(url, init);
      }
      const result = handlerIterator.next();
      if (result.done === false) {
        const { handler, params, path } = result.value;
        const context = {
          request: new Request(request.clone()),
          functionPath: path,
          next,
          params,
          get data() {
            return data;
          },
          set data(value) {
            if (typeof value !== "object" || value === null) {
              throw new Error("context.data must be an object");
            }
            data = value;
          },
          env,
          waitUntil: workerContext.waitUntil.bind(workerContext),
          passThroughOnException: /* @__PURE__ */ __name(() => {
            isFailOpen = true;
          }, "passThroughOnException")
        };
        const response = await handler(context);
        if (!(response instanceof Response)) {
          throw new Error("Your Pages function should return a Response");
        }
        return cloneResponse(response);
      } else if ("ASSETS") {
        const response = await env["ASSETS"].fetch(request);
        return cloneResponse(response);
      } else {
        const response = await fetch(request);
        return cloneResponse(response);
      }
    }, "next");
    try {
      return await next();
    } catch (error) {
      if (isFailOpen) {
        const response = await env["ASSETS"].fetch(request);
        return cloneResponse(response);
      }
      throw error;
    }
  }
};
var cloneResponse = /* @__PURE__ */ __name((response) => (
  // https://fetch.spec.whatwg.org/#null-body-status
  new Response(
    [101, 204, 205, 304].includes(response.status) ? null : response.body,
    response
  )
), "cloneResponse");

// ../node_modules/wrangler/templates/middleware/middleware-ensure-req-body-drained.ts
var drainBody = /* @__PURE__ */ __name(async (request, env, _ctx, middlewareCtx) => {
  try {
    return await middlewareCtx.next(request, env);
  } finally {
    try {
      if (request.body !== null && !request.bodyUsed) {
        const reader = request.body.getReader();
        while (!(await reader.read()).done) {
        }
      }
    } catch (e) {
      console.error("Failed to drain the unused request body.", e);
    }
  }
}, "drainBody");
var middleware_ensure_req_body_drained_default = drainBody;

// ../node_modules/wrangler/templates/middleware/middleware-miniflare3-json-error.ts
function reduceError(e) {
  return {
    name: e?.name,
    message: e?.message ?? String(e),
    stack: e?.stack,
    cause: e?.cause === void 0 ? void 0 : reduceError(e.cause)
  };
}
__name(reduceError, "reduceError");
var jsonError = /* @__PURE__ */ __name(async (request, env, _ctx, middlewareCtx) => {
  try {
    return await middlewareCtx.next(request, env);
  } catch (e) {
    const error = reduceError(e);
    return Response.json(error, {
      status: 500,
      headers: { "MF-Experimental-Error-Stack": "true" }
    });
  }
}, "jsonError");
var middleware_miniflare3_json_error_default = jsonError;

// ../.wrangler/tmp/bundle-x6oWSQ/middleware-insertion-facade.js
var __INTERNAL_WRANGLER_MIDDLEWARE__ = [
  middleware_ensure_req_body_drained_default,
  middleware_miniflare3_json_error_default
];
var middleware_insertion_facade_default = pages_template_worker_default;

// ../node_modules/wrangler/templates/middleware/common.ts
var __facade_middleware__ = [];
function __facade_register__(...args) {
  __facade_middleware__.push(...args.flat());
}
__name(__facade_register__, "__facade_register__");
function __facade_invokeChain__(request, env, ctx, dispatch, middlewareChain) {
  const [head, ...tail] = middlewareChain;
  const middlewareCtx = {
    dispatch,
    next(newRequest, newEnv) {
      return __facade_invokeChain__(newRequest, newEnv, ctx, dispatch, tail);
    }
  };
  return head(request, env, ctx, middlewareCtx);
}
__name(__facade_invokeChain__, "__facade_invokeChain__");
function __facade_invoke__(request, env, ctx, dispatch, finalMiddleware) {
  return __facade_invokeChain__(request, env, ctx, dispatch, [
    ...__facade_middleware__,
    finalMiddleware
  ]);
}
__name(__facade_invoke__, "__facade_invoke__");

// ../.wrangler/tmp/bundle-x6oWSQ/middleware-loader.entry.ts
var __Facade_ScheduledController__ = class ___Facade_ScheduledController__ {
  constructor(scheduledTime, cron, noRetry) {
    this.scheduledTime = scheduledTime;
    this.cron = cron;
    this.#noRetry = noRetry;
  }
  static {
    __name(this, "__Facade_ScheduledController__");
  }
  #noRetry;
  noRetry() {
    if (!(this instanceof ___Facade_ScheduledController__)) {
      throw new TypeError("Illegal invocation");
    }
    this.#noRetry();
  }
};
function wrapExportedHandler(worker) {
  if (__INTERNAL_WRANGLER_MIDDLEWARE__ === void 0 || __INTERNAL_WRANGLER_MIDDLEWARE__.length === 0) {
    return worker;
  }
  for (const middleware of __INTERNAL_WRANGLER_MIDDLEWARE__) {
    __facade_register__(middleware);
  }
  const fetchDispatcher = /* @__PURE__ */ __name(function(request, env, ctx) {
    if (worker.fetch === void 0) {
      throw new Error("Handler does not export a fetch() function.");
    }
    return worker.fetch(request, env, ctx);
  }, "fetchDispatcher");
  return {
    ...worker,
    fetch(request, env, ctx) {
      const dispatcher = /* @__PURE__ */ __name(function(type, init) {
        if (type === "scheduled" && worker.scheduled !== void 0) {
          const controller = new __Facade_ScheduledController__(
            Date.now(),
            init.cron ?? "",
            () => {
            }
          );
          return worker.scheduled(controller, env, ctx);
        }
      }, "dispatcher");
      return __facade_invoke__(request, env, ctx, dispatcher, fetchDispatcher);
    }
  };
}
__name(wrapExportedHandler, "wrapExportedHandler");
function wrapWorkerEntrypoint(klass) {
  if (__INTERNAL_WRANGLER_MIDDLEWARE__ === void 0 || __INTERNAL_WRANGLER_MIDDLEWARE__.length === 0) {
    return klass;
  }
  for (const middleware of __INTERNAL_WRANGLER_MIDDLEWARE__) {
    __facade_register__(middleware);
  }
  return class extends klass {
    #fetchDispatcher = /* @__PURE__ */ __name((request, env, ctx) => {
      this.env = env;
      this.ctx = ctx;
      if (super.fetch === void 0) {
        throw new Error("Entrypoint class does not define a fetch() function.");
      }
      return super.fetch(request);
    }, "#fetchDispatcher");
    #dispatcher = /* @__PURE__ */ __name((type, init) => {
      if (type === "scheduled" && super.scheduled !== void 0) {
        const controller = new __Facade_ScheduledController__(
          Date.now(),
          init.cron ?? "",
          () => {
          }
        );
        return super.scheduled(controller);
      }
    }, "#dispatcher");
    fetch(request) {
      return __facade_invoke__(
        request,
        this.env,
        this.ctx,
        this.#dispatcher,
        this.#fetchDispatcher
      );
    }
  };
}
__name(wrapWorkerEntrypoint, "wrapWorkerEntrypoint");
var WRAPPED_ENTRY;
if (typeof middleware_insertion_facade_default === "object") {
  WRAPPED_ENTRY = wrapExportedHandler(middleware_insertion_facade_default);
} else if (typeof middleware_insertion_facade_default === "function") {
  WRAPPED_ENTRY = wrapWorkerEntrypoint(middleware_insertion_facade_default);
}
var middleware_loader_entry_default = WRAPPED_ENTRY;
export {
  __INTERNAL_WRANGLER_MIDDLEWARE__,
  middleware_loader_entry_default as default
};
//# sourceMappingURL=functionsWorker-0.8356468564597987.mjs.map

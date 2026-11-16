// Detect the currently running Steam game and map it to its PipeWire audio streams.
//
// Games launched by Steam (native and Proton) inherit SteamAppId / SteamGameId in
// their environment, and run beneath a `reaper SteamLaunch AppId=<id>` process.
// Each PipeWire stream reports the owning process via application.process.id, so we
// check that process's environment (and, failing that, its ancestors' command lines)
// to find which Steam app it belongs to.

const fs = require("fs");
const path = require("path");
const os = require("os");
const pipewire = require("./pipewire");

const fsp = fs.promises;
const MAX_ANCESTOR_DEPTH = 12;

// pid -> appId (string) or null. Pruned to live stream pids on each lookup.
const pidCache = new Map();
// appId -> game name (string) or null
const nameCache = new Map();

function parseEnvAppId(environ) {
  let appId = null;
  let gameId = null;
  for (const entry of environ.split("\0")) {
    if (entry.startsWith("SteamAppId=")) appId = entry.slice(11);
    else if (entry.startsWith("SteamGameId=")) gameId = entry.slice(12);
    else if (!appId && entry.startsWith("STEAM_COMPAT_APP_ID=")) appId = entry.slice(20);
  }
  // SteamAppId is "0" for non-Steam shortcuts; SteamGameId then holds the shortcut id.
  if (appId && appId !== "0") return appId;
  if (gameId && gameId !== "0") return gameId;
  return null;
}

async function readParentPid(pid) {
  const stat = await fsp.readFile(`/proc/${pid}/stat`, "utf8");
  // Fields after the parenthesised comm (which may itself contain spaces/parens)
  const rest = stat.slice(stat.lastIndexOf(")") + 2).split(" ");
  return parseInt(rest[1], 10);
}

async function lookupPid(pid) {
  let current = pid;
  for (let depth = 0; depth < MAX_ANCESTOR_DEPTH && current > 1; depth++) {
    try {
      const environ = await fsp.readFile(`/proc/${current}/environ`, "utf8");
      const fromEnv = parseEnvAppId(environ);
      if (fromEnv) return fromEnv;
    } catch {
      // Not readable (exited, or another user's process); fall through to cmdline
    }
    try {
      const cmdline = (await fsp.readFile(`/proc/${current}/cmdline`, "utf8")).split("\0");
      if (cmdline.includes("SteamLaunch")) {
        const arg = cmdline.find((a) => /^AppId=\d+$/.test(a));
        if (arg && arg !== "AppId=0") return arg.slice(6);
      }
      current = await readParentPid(current);
    } catch {
      return null;
    }
  }
  return null;
}

async function steamAppIdForPid(pid) {
  if (pidCache.has(pid)) return pidCache.get(pid);
  const appId = await lookupPid(pid);
  pidCache.set(pid, appId);
  return appId;
}

// --- Game name lookup from Steam library manifests ---

function steamRoots() {
  const home = os.homedir();
  return [
    path.join(home, ".local/share/Steam"),
    path.join(home, ".steam/steam"),
    path.join(home, ".var/app/com.valvesoftware.Steam/.local/share/Steam"),
    path.join(home, ".var/app/com.valvesoftware.Steam/data/Steam"),
    path.join(home, "snap/steam/common/.local/share/Steam"),
  ];
}

async function libraryPaths() {
  const paths = new Set();
  for (const root of steamRoots()) {
    paths.add(root);
    try {
      const vdf = await fsp.readFile(path.join(root, "steamapps/libraryfolders.vdf"), "utf8");
      for (const m of vdf.matchAll(/"path"\s+"((?:[^"\\]|\\.)*)"/g)) {
        paths.add(m[1].replace(/\\(.)/g, "$1"));
      }
    } catch {
      // Root not present
    }
  }
  return [...paths];
}

async function lookupGameName(appId) {
  for (const lib of await libraryPaths()) {
    try {
      const acf = await fsp.readFile(path.join(lib, "steamapps", `appmanifest_${appId}.acf`), "utf8");
      const m = acf.match(/"name"\s+"((?:[^"\\]|\\.)*)"/);
      if (m) return m[1].replace(/\\(.)/g, "$1");
    } catch {
      // Not in this library
    }
  }
  return null;
}

async function gameName(appId) {
  if (nameCache.has(appId)) return nameCache.get(appId);
  const name = await lookupGameName(appId);
  nameCache.set(appId, name);
  return name;
}

// --- Public API ---

// Find the running Steam game with active audio streams.
// Callback receives { appId, name, ids } or null when no game is producing audio.
// If several games have streams, the one with the most recently created stream wins.
function getRunningGame(callback) {
  pipewire.getAppList(async (apps) => {
    try {
      const livePids = new Set(apps.map((a) => a.pid).filter(Boolean));
      for (const pid of pidCache.keys()) {
        if (!livePids.has(pid)) pidCache.delete(pid);
      }

      const games = new Map(); // appId -> { ids, newest, streamName }
      for (const app of apps) {
        if (!app.pid) continue;
        const appId = await steamAppIdForPid(app.pid);
        if (!appId) continue;
        let g = games.get(appId);
        if (!g) {
          g = { ids: [], newest: -1, streamName: app.appName || app.name };
          games.set(appId, g);
        }
        g.ids.push(app.id);
        if (app.id > g.newest) g.newest = app.id;
      }

      if (games.size === 0) return callback(null);

      let bestId = null;
      let best = null;
      for (const [appId, g] of games) {
        if (!best || g.newest > best.newest) {
          best = g;
          bestId = appId;
        }
      }

      const name = (await gameName(bestId)) || best.streamName || `App ${bestId}`;
      callback({ appId: bestId, name, ids: best.ids });
    } catch (e) {
      console.error("Steam game lookup failed:", e.message);
      callback(null);
    }
  });
}

module.exports = { getRunningGame };

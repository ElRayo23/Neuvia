// Neuvia API: the single production editor and live reader use the main branch.
const ORIGIN = "https://neuvia-editor-preview.pages.dev";
const ORIGINS = [ORIGIN];
const OWNER = "ElRayo23";
const REPO = "Neuvia";
const BRANCH = "main";
const API = "https://api.github.com";
const enc = new TextEncoder();

const b64url = (b) => btoa(String.fromCharCode(...new Uint8Array(b)))
  .replace(/=/g, "").replaceAll("+", "-").replaceAll("/", "_");

async function keyFor(secret) {
  return crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
}
async function issue(secret) {
  const payload = b64url(enc.encode(JSON.stringify({ sub: "admin", exp: Math.floor(Date.now() / 1000) + 3600 })));
  const key = await keyFor(secret);
  return payload + "." + b64url(await crypto.subtle.sign("HMAC", key, enc.encode(payload)));
}
async function valid(token, secret) {
  if (!token || !secret) return false;
  const [payload, signature] = token.split(".");
  if (!payload || !signature) return false;
  const key = await keyFor(secret);
  if (b64url(await crypto.subtle.sign("HMAC", key, enc.encode(payload))) !== signature) return false;
  try {
    return JSON.parse(atob(payload.replace(/-/g, "+").replace(/_/g, "/"))).exp > Math.floor(Date.now() / 1000);
  } catch { return false; }
}
function response(data, status = 200, origin = ORIGIN) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
      "Access-Control-Allow-Origin": origin,
      "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type,Authorization",
      "Vary": "Origin",
    },
  });
}
function bearer(request) {
  const header = request.headers.get("Authorization") || "";
  return header.startsWith("Bearer ") ? header.slice(7) : "";
}
function safePath(path) {
  if (typeof path !== "string" || path.length > 500 || !path.toLowerCase().endsWith(".md") || path.startsWith("/") || path.includes("\\")) return false;
  const parts = path.split("/");
  return parts.every((part) => part && part !== "." && part !== ".." && !part.startsWith("."))
    && !parts.some((part) => ["private", "templates"].includes(part.toLowerCase()));
}
function githubUrl(path) {
  return API + "/repos/" + OWNER + "/" + REPO + "/contents/" + path.split("/").map(encodeURIComponent).join("/");
}
async function readFile(path, token) {
  const result = await fetch(githubUrl(path) + "?ref=" + BRANCH, {
    headers: {
      "Authorization": "Bearer " + token,
      "Accept": "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "Neuvia-Admin-Editor",
    },
  });
  const raw = await result.text();
  let data = {};
  try { data = JSON.parse(raw); } catch {}
  if (!result.ok) {
    if (result.status === 404) throw new Error("Markdown-Datei nicht gefunden: " + path);
    const detail = data.message || raw.trim().replace(/\s+/g, " ").slice(0, 180);
    const requestId = result.headers.get("x-github-request-id");
    throw new Error("GitHub-API Fehler " + result.status + (detail ? ": " + detail : "") + (requestId ? " (Request " + requestId + ")" : ""));
  }
  if (typeof data.content !== "string" || !data.sha || (data.type && data.type !== "file")) {
    throw new Error("GitHub hat keine lesbare Datei geliefert (Typ: " + String(data.type || "unbekannt") + ", Größe: " + String(data.size ?? "unbekannt") + ").");
  }
  const binary = atob(data.content.replace(/\s/g, ""));
  return {
    content: new TextDecoder().decode(Uint8Array.from(binary, (char) => char.charCodeAt(0))),
    sha: data.sha,
  };
}
function encodeBase64(value) {
  const bytes = enc.encode(value);
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}


function safeFolderPath(path) {
  if (typeof path !== "string" || path.length > 500 || path.startsWith("/") || path.includes("\\")) return false;
  if (!path) return true;
  return path.split("/").every((part) => part && part !== "." && part !== ".." && !part.startsWith(".")
    && !["private", "templates"].includes(part.toLowerCase()));
}
function visiblePath(path) {
  const parts = path ? path.split("/") : [];
  const hiddenRoots = new Set([".github", ".obsidian", ".noteser", ".git", "static", "workers", ".quartz-runtime"]);
  if (parts.some((part) => part.startsWith(".") || ["private", "templates"].includes(part.toLowerCase()))) return false;
  return !hiddenRoots.has(parts[0]);
}
const IMAGE_EXTENSIONS = new Set(["png", "jpg", "jpeg", "webp", "gif", "avif"]);
const MIME_BY_EXTENSION = {
  png: ["image/png"], jpg: ["image/jpeg"], jpeg: ["image/jpeg"],
  webp: ["image/webp"], gif: ["image/gif"], avif: ["image/avif"],
};
function safePublicAssetPath(path) {
  if (typeof path !== "string" || !path || path.length > 500 || path.startsWith("/") || path.indexOf(String.fromCharCode(92)) !== -1) return false;
  const parts = path.split("/");
  if (!parts.every((part) => part && part !== "." && part !== ".." && !part.startsWith("."))) return false;
  if (parts.some((part) => ["private", "templates"].includes(part.toLowerCase()))) return false;
  return ["png", "jpg", "jpeg", "webp", "gif", "avif", "pdf"].includes(path.split(".").pop().toLowerCase());
}

function visibleFile(path) {
  const ext = path.split(".").pop().toLowerCase();
  return ext === "md" || ext === "pdf" || IMAGE_EXTENSIONS.has(ext);
}
function encodeBase64Bytes(bytes) {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}
async function githubContentsWrite(path, body, token) {
  const result = await fetch(githubUrl(path), {
    method: "PUT",
    headers: {
      "Authorization": "Bearer " + token,
      "Accept": "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "Neuvia-Admin-Editor",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ ...body, branch: BRANCH }),
  });
  const data = await result.json().catch(() => ({}));
  if (!result.ok) {
    const detail = data.message || result.statusText || "Unbekannte GitHub-Antwort";
    const error = new Error((result.status === 409 || result.status === 422)
      ? "Die Datei konnte nicht gespeichert werden, weil sie bereits existiert oder zwischenzeitlich geändert wurde."
      : "GitHub-API Fehler " + result.status + ": " + detail);
    error.status = result.status;
    throw error;
  }
  return data;
}
function safeUploadFilename(filename) {
  const original = String(filename || "bild").normalize("NFC").split(/[\\/]/).pop();
  const dot = original.lastIndexOf(".");
  if (dot <= 0) throw new Error("Die Bilddatei braucht eine gültige Dateiendung.");
  const extension = original.slice(dot + 1).toLowerCase();
  if (!IMAGE_EXTENSIONS.has(extension)) throw new Error("Erlaubt sind PNG, JPG, WebP, GIF und AVIF.");
  const stem = original.slice(0, dot)
    .replace(/[^\p{L}\p{N}._-]+/gu, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/^\.+/, "")
    .slice(0, 100);
  if (!stem) throw new Error("Der Bildname ist ungültig.");
  return stem + "." + extension;
}



async function githubJson(path, token, method = "GET", body) {
  const result = await fetch(API + path, {
    method,
    headers: {
      "Authorization": "Bearer " + token,
      "Accept": "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "Neuvia-Admin-Editor",
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const data = await result.json().catch(() => ({}));
  if (!result.ok) {
    const detail = data.message || result.statusText || "Unbekannte GitHub-Antwort";
    throw new Error("GitHub-API Fehler " + result.status + ": " + detail);
  }
  return data;
}
async function scanMarkdownArchive(token, commitSha, visit) {
  const archive = await fetch(API + "/repos/" + OWNER + "/" + REPO + "/tarball/" + commitSha, {
    headers: {
      "Authorization": "Bearer " + token,
      "Accept": "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "Neuvia-Admin-Editor",
    },
  });
  if (!archive.ok || !archive.body) throw new Error("GitHub konnte die Notizen für die Link-Aktualisierung nicht laden (HTTP " + archive.status + ").");
  let stream;
  try { stream = archive.body.pipeThrough(new DecompressionStream("gzip")); }
  catch { throw new Error("Die GitHub-Archivdatei konnte nicht für die Link-Aktualisierung geöffnet werden."); }

  // TAR-Dateien blockweise lesen, statt das gesamte entpackte Repository im Speicher zu halten.
  const reader = stream.getReader();
  let chunk = new Uint8Array(0);
  let chunkOffset = 0;
  const decoder = new TextDecoder();

  async function readExact(length) {
    const output = new Uint8Array(length);
    let written = 0;
    while (written < length) {
      if (chunkOffset >= chunk.length) {
        const next = await reader.read();
        if (next.done) break;
        chunk = next.value;
        chunkOffset = 0;
        continue;
      }
      const take = Math.min(length - written, chunk.length - chunkOffset);
      output.set(chunk.subarray(chunkOffset, chunkOffset + take), written);
      chunkOffset += take;
      written += take;
    }
    return written === length ? output : output.subarray(0, written);
  }

  async function skipExact(length) {
    let remaining = length;
    while (remaining > 0) {
      if (chunkOffset >= chunk.length) {
        const next = await reader.read();
        if (next.done) return false;
        chunk = next.value;
        chunkOffset = 0;
        continue;
      }
      const take = Math.min(remaining, chunk.length - chunkOffset);
      chunkOffset += take;
      remaining -= take;
    }
    return true;
  }

  try {
    while (true) {
      const header = await readExact(512);
      if (header.length < 512 || header.every((value) => value === 0)) break;
      const readString = (from, length) => decoder.decode(header.subarray(from, from + length)).split("\0")[0];
      const name = readString(0, 100);
      const prefix = readString(345, 155);
      const archivePath = prefix ? prefix + "/" + name : name;
      const sizeText = readString(124, 12).trim();
      const size = sizeText ? parseInt(sizeText, 8) : 0;
      if (!Number.isFinite(size) || size < 0) throw new Error("Ungültige Dateigröße im GitHub-Archiv.");
      const type = readString(156, 1);
      const slash = archivePath.indexOf("/");
      const relativePath = slash >= 0 ? archivePath.slice(slash + 1) : archivePath;
      const isMarkdown = relativePath.toLowerCase().endsWith(".md") && (!type || type === "0");

      if (isMarkdown) {
        if (size > 8 * 1024 * 1024) throw new Error("Eine Markdown-Datei ist größer als 8 MB. Umbenennen wurde sicherheitshalber abgebrochen.");
        const contents = await readExact(size);
        if (contents.length !== size) throw new Error("Die GitHub-Archivdatei wurde unvollständig übertragen.");
        visit(relativePath, decoder.decode(contents));
      } else if (!(await skipExact(size))) {
        throw new Error("Die GitHub-Archivdatei wurde unvollständig übertragen.");
      }
      const padding = (512 - (size % 512)) % 512;
      if (padding && !(await skipExact(padding))) break;
    }
  } finally {
    reader.releaseLock();
  }
}

async function moveVaultPath(source, destination, token) {
  const branch = await githubJson("/repos/" + OWNER + "/" + REPO + "/branches/" + encodeURIComponent(BRANCH), token);
  const parentSha = branch.commit?.sha;
  const baseTreeSha = branch.commit?.commit?.tree?.sha;
  if (!parentSha || !baseTreeSha) throw new Error("GitHub hat den aktuellen Branch-Stand nicht vollständig geliefert.");

  const treeData = await githubJson(
    "/repos/" + OWNER + "/" + REPO + "/git/trees/" + baseTreeSha + "?recursive=1",
    token
  );
  if (treeData.truncated) throw new Error("GitHub hat die Dateiliste gekürzt. Der Ordner ist für diese Aktion zu groß.");

  const entries = treeData.tree || [];
  const sourceEntry = entries.find((entry) => entry.path === source);
  if (!sourceEntry) throw new Error("Die Quelldatei oder der Quellordner existiert nicht mehr.");
  const isFolder = sourceEntry.type === "tree";
  if (isFolder && entries.some((entry) => entry.path.startsWith(source + "/") && !visiblePath(entry.path))) {
    throw new Error("Der Ordner enthält ausgeblendete Dateien. Bitte verschiebe diese Inhalte nicht gemeinsam mit dem sichtbaren Ordner.");
  }
  if (isFolder && entries.some((entry) => entry.path.startsWith(source + "/") && entry.type === "commit")) {
    throw new Error("Der Ordner enthält ein Git-Submodul, das nicht automatisch verschoben werden kann.");
  }
  if (!isFolder && (sourceEntry.type !== "blob" || !visibleFile(source))) {
    throw new Error("Dieser Dateityp darf nicht verschoben werden.");
  }
  if (!isFolder && source.split(".").pop().toLowerCase() !== destination.split(".").pop().toLowerCase()) {
    throw new Error("Die Dateiendung darf beim Verschieben nicht geändert werden.");
  }
  if (isFolder && destination.startsWith(source + "/")) {
    throw new Error("Ein Ordner kann nicht in sich selbst verschoben werden.");
  }
  if (isFolder && entries.some((entry) => entry.path === destination || entry.path.startsWith(destination + "/"))) {
    throw new Error("Am Ziel existiert bereits ein Ordner oder eine Datei: " + destination);
  }
  const moving = isFolder
    ? entries.filter((entry) => entry.type === "blob" && entry.path.startsWith(source + "/"))
    : (sourceEntry.type === "blob" ? [sourceEntry] : []);
  if (!moving.length) throw new Error("Die Quelle enthält keine verschiebbaren Dateien.");

  const destinations = moving.map((entry) => ({
    source: entry.path,
    path: isFolder ? destination + entry.path.slice(source.length) : destination,
    mode: entry.mode,
    type: entry.type,
    sha: entry.sha,
  }));
  const existingPaths = new Set(entries.map((entry) => entry.path));
  for (const target of destinations) {
    if (existingPaths.has(target.path) || entries.some((entry) => entry.path.startsWith(target.path + "/"))) {
      throw new Error("Am Ziel existiert bereits eine Datei oder ein Ordner: " + target.path);
    }
    const parentParts = target.path.split("/");
    parentParts.pop();
    let parent = "";
    for (const segment of parentParts) {
      parent = parent ? parent + "/" + segment : segment;
      const conflicting = entries.find((entry) => entry.path === parent && entry.type === "blob");
      if (conflicting) throw new Error("Der Zielpfad liegt innerhalb einer Datei: " + parent);
    }
  }

  const markdownPaths = entries
    .filter((entry) => entry.type === "blob" && entry.path.toLowerCase().endsWith(".md"))
    .map((entry) => entry.path);
  const movedPath = new Map(destinations.map((item) => [item.source, item.path]));
  const basenameCounts = new Map();
  for (const path of markdownPaths) {
    const base = path.split("/").pop().replace(/\.md$/i, "").toLocaleLowerCase("de");
    basenameCounts.set(base, (basenameCounts.get(base) || 0) + 1);
  }
  const targetMap = new Map();
  for (const item of destinations) {
    if (!item.source.toLowerCase().endsWith(".md")) continue;
    const oldTarget = item.source.replace(/\.md$/i, "");
    const newTarget = item.path.replace(/\.md$/i, "");
    targetMap.set(oldTarget.toLocaleLowerCase("de"), newTarget);
    const oldBase = oldTarget.split("/").pop();
    if (basenameCounts.get(oldBase.toLocaleLowerCase("de")) === 1) {
      targetMap.set(oldBase.toLocaleLowerCase("de"), newTarget.split("/").pop());
    }
  }
  if (isFolder) {
    targetMap.set(source.toLocaleLowerCase("de"), destination);
  }

  const treeChanges = new Map();
  for (const target of destinations) {
    treeChanges.set(target.path, { path: target.path, mode: target.mode, type: target.type, sha: target.sha });
    treeChanges.set(target.source, { path: target.source, mode: target.mode, type: target.type, sha: null });
  }
  let rewrittenNotes = 0;
  const wikilink = /(!?\[\[)([^\]|#]+)(#[^\]|]*)?(\|[^\]]*)?(\]\])/g;
  await scanMarkdownArchive(token, parentSha, (originalPath, originalContent) => {
    const nextPath = movedPath.get(originalPath) || originalPath;
    let changed = false;
    const content = originalContent.replace(wikilink, (match, open, rawTarget, anchor, alias, close) => {
      const leading = rawTarget.match(/^\s*/)?.[0] || "";
      const trailing = rawTarget.match(/\s*$/)?.[0] || "";
      const target = rawTarget.trim().replace(/^\.\//, "").replace(/\.md$/i, "");
      const normalized = target.toLocaleLowerCase("de");
      let replacementTarget = targetMap.get(normalized) || "";
      if (!replacementTarget && isFolder && normalized.startsWith(source.toLocaleLowerCase("de") + "/")) {
        replacementTarget = destination + target.slice(source.length);
      }
      if (!replacementTarget || replacementTarget === target) return match;
      changed = true;
      return open + leading + replacementTarget + trailing + (anchor || "") + (alias || "") + close;
    });
    if (changed) {
      treeChanges.set(nextPath, { path: nextPath, mode: "100644", type: "blob", content });
      rewrittenNotes++;
    }
  });

  const changes = Array.from(treeChanges.values());
  if (changes.length > 1800) throw new Error("Zu viele Linkänderungen für einen einzelnen sicheren Verschiebevorgang. Bitte verschiebe kleinere Ordner.");
  const newTree = await githubJson(
    "/repos/" + OWNER + "/" + REPO + "/git/trees",
    token,
    "POST",
    { base_tree: baseTreeSha, tree: changes }
  );
  if (!newTree.sha) throw new Error("GitHub hat keinen neuen Dateibaum erstellt.");
  const commit = await githubJson(
    "/repos/" + OWNER + "/" + REPO + "/git/commits",
    token,
    "POST",
    {
      message: "Neuvia: " + (isFolder ? "Ordner" : "Datei") + " verschoben; Wiki-Links aktualisiert",
      tree: newTree.sha,
      parents: [parentSha],
    }
  );
  if (!commit.sha) throw new Error("GitHub hat keinen Verschiebe-Commit erstellt.");
  await githubJson(
    "/repos/" + OWNER + "/" + REPO + "/git/refs/heads/" + BRANCH,
    token,
    "PATCH",
    { sha: commit.sha, force: false }
  );
  return { commit: commit.sha, count: moving.length, isFolder, rewrittenNotes };
}


async function deleteVaultPath(path, mode, token) {
  const branch = await githubJson("/repos/" + OWNER + "/" + REPO + "/branches/" + encodeURIComponent(BRANCH), token);
  const parentSha = branch.commit?.sha;
  const baseTreeSha = branch.commit?.commit?.tree?.sha;
  if (!parentSha || !baseTreeSha) throw new Error("GitHub hat den aktuellen Branch-Stand nicht vollständig geliefert.");
  const treeData = await githubJson("/repos/" + OWNER + "/" + REPO + "/git/trees/" + baseTreeSha + "?recursive=1", token);
  if (treeData.truncated) throw new Error("Die Dateiliste wurde gekürzt; Aktion aus Sicherheitsgründen abgebrochen.");
  const entries = (treeData.tree || []).filter((entry) => entry.type === "blob");
  const folder = entries.some((entry) => entry.path.startsWith(path + "/"));
  const source = entries.find((entry) => entry.path === path);
  if (mode === "file" && (!source || !visibleFile(path) || !visiblePath(path))) throw new Error("Die Datei existiert nicht oder darf nicht gelöscht werden.");
  if (mode !== "file" && (!folder || !safeFolderPath(path) || !visiblePath(path))) throw new Error("Der Ordner existiert nicht oder darf nicht gelöscht werden.");
  let changes = [];
  const deletionEntry = (entry) => ({ path: entry.path, mode: entry.mode, type: "blob", sha: null });
  if (mode === "file") {
    changes = [deletionEntry(source)];
  } else {
    const inside = entries.filter((entry) => entry.path.startsWith(path + "/"));
    if (inside.some((entry) => !visiblePath(entry.path))) throw new Error("Der Ordner enthält ausgeblendete Dateien. Löschung abgebrochen.");
    if (mode === "recursive") {
      changes = inside.map(deletionEntry);
    } else if (mode === "contents") {
      const parent = path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "";
      const moved = inside.map((entry) => ({ entry, target: [parent, entry.path.slice(path.length + 1)].filter(Boolean).join("/") }));
      const occupied = new Set(entries.filter((entry) => !entry.path.startsWith(path + "/")).map((entry) => entry.path));
      const mergeTargets = new Set();
      for (const item of moved) {
        const indexCollision = item.target.endsWith("/index.md") && occupied.has(item.target);
        if (indexCollision) {
          mergeTargets.add(item.target);
          continue;
        }
        if (occupied.has(item.target) || moved.some((other) => other !== item && (other.target === item.target || other.target.startsWith(item.target + "/") || item.target.startsWith(other.target + "/")))) {
          throw new Error("Zielkonflikt beim Eine-Ebene-hoch-Verschieben: " + item.target + ". Es wurde nichts geändert.");
        }
      }
      for (const target of mergeTargets) {
        const targetEntry = entries.find((entry) => entry.path === target);
        const sourceItem = moved.find((item) => item.target === target);
        if (!targetEntry || !sourceItem || !target.endsWith("/index.md")) {
          throw new Error("Die Index-Dateien konnten nicht eindeutig zusammengeführt werden. Es wurde nichts geändert.");
        }
      }
      changes = [];
      for (const { entry, target } of moved) {
        if (mergeTargets.has(target)) {
          const [targetFile, sourceFile] = await Promise.all([
            readFile(target, token),
            readFile(entry.path, token),
          ]);
          const sourceBody = sourceFile.content.replace(/^---\r?\n[\s\S]*?\r?\n---\s*(?:\r?\n|$)/, "").trim();
          const mergedContent = targetFile.content.trimEnd() + (sourceBody ? "\n\n---\n\n" + sourceBody : "") + "\n";
          const blob = await githubJson("/repos/" + OWNER + "/" + REPO + "/git/blobs", token, "POST", {
            content: mergedContent,
            encoding: "utf-8",
          });
          if (!blob.sha) throw new Error("GitHub hat die zusammengeführte Index-Datei nicht erstellt.");
          changes.push({ path: target, mode: entry.mode, type: "blob", sha: blob.sha });
          changes.push(deletionEntry(entry));
        } else {
          changes.push({ path: target, mode: entry.mode, type: "blob", sha: entry.sha });
          changes.push(deletionEntry(entry));
        }
      }
    } else throw new Error("Ungültiger Löschmodus.");
  }
  if (!changes.length) throw new Error("Der Ordner enthält keine Dateien.");
  const newTree = await githubJson("/repos/" + OWNER + "/" + REPO + "/git/trees", token, "POST", { base_tree: baseTreeSha, tree: changes });
  if (!newTree.sha) throw new Error("GitHub hat keinen neuen Dateibaum erstellt.");
  const commit = await githubJson("/repos/" + OWNER + "/" + REPO + "/git/commits", token, "POST", {
    message: "Neuvia: " + (mode === "contents" ? "Ordnerinhalt eine Ebene hoch verschoben" : "Inhalt gelöscht"),
    tree: newTree.sha, parents: [parentSha]
  });
  await githubJson("/repos/" + OWNER + "/" + REPO + "/git/refs/heads/" + BRANCH, token, "PATCH", { sha: commit.sha, force: false });
  return { commit: commit.sha, count: mode === "file" ? 1 : changes.filter((item) => item.sha === null).length };
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const origin = request.headers.get("Origin");
    const allowedOrigin = ORIGINS.includes(origin) ? origin : ORIGIN;
    const send = (data, status = 200) => response(data, status, allowedOrigin);

    if (origin && !ORIGINS.includes(origin)) return send({ error: "Origin not allowed" }, 403);
    if (request.method === "OPTIONS") return send({});
    if (url.pathname === "/api/health") {
      return send({
        ok: true,
        configured: !!(env.ADMIN_PASSWORD && env.SESSION_SECRET),
        githubConfigured: !!env.GITHUB_TOKEN,
        branch: BRANCH,
      });
    }
    // Public, read-only access to visible Markdown. This lets the website fetch
    // the current source note without waiting for a Quartz rebuild.
    if (url.pathname === "/api/public-note" && request.method === "GET") {
      if (!env.GITHUB_TOKEN) return send({ error: "GitHub-Zugriff ist nicht konfiguriert." }, 503);
      const path = url.searchParams.get("path") || "";
      if (!safePath(path) || !visiblePath(path)) return send({ error: "Diese Notiz darf nicht öffentlich geladen werden." }, 400);
      try {
        const file = await readFile(path, env.GITHUB_TOKEN);
        return new Response(JSON.stringify({ path, content: file.content, sha: file.sha }), {
          headers: {
            "Content-Type": "application/json; charset=utf-8",
            "Cache-Control": "no-store",
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Methods": "GET,OPTIONS",
            "Access-Control-Allow-Headers": "Content-Type,Authorization",
            "X-Content-Type-Options": "nosniff",
          },
        });
      } catch (error) {
        const status = /nicht gefunden/i.test(error.message) ? 404 : 502;
        return send({ error: error.message }, status);
      }
    }

    // Public delivery of visible images and PDFs from the current test-branch source.
    if (url.pathname === "/api/public-asset" && request.method === "GET") {
      if (!env.GITHUB_TOKEN) return send({ error: "GitHub-Zugriff ist nicht konfiguriert." }, 503);
      const path = url.searchParams.get("path") || "";
      if (!safePublicAssetPath(path) || !visiblePath(path)) return send({ error: "Diese Datei darf nicht öffentlich geladen werden." }, 400);
      const extension = path.split(".").pop().toLowerCase();
      try {
        const result = await fetch(githubUrl(path) + "?ref=" + encodeURIComponent(BRANCH), {
          headers: {
            "Authorization": "Bearer " + env.GITHUB_TOKEN,
            "Accept": "application/vnd.github.raw",
            "X-GitHub-Api-Version": "2022-11-28",
            "User-Agent": "Neuvia-Public-Reader",
          },
        });
        if (!result.ok) return send({ error: result.status === 404 ? "Datei nicht gefunden." : "Datei konnte nicht geladen werden." }, result.status === 404 ? 404 : 502);
        const mime = {
          png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg",
          webp: "image/webp", gif: "image/gif", avif: "image/avif", pdf: "application/pdf",
        }[extension];
        return new Response(result.body, {
          headers: {
            "Content-Type": mime,
            "Cache-Control": "no-store",
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Methods": "GET,OPTIONS",
            "X-Content-Type-Options": "nosniff",
            "Content-Disposition": "inline",
          },
        });
      } catch (error) {
        return send({ error: error.message || "Datei konnte nicht geladen werden." }, 502);
      }
    }

    if (url.pathname === "/api/login" && request.method === "POST") {
      if (!env.ADMIN_PASSWORD || !env.SESSION_SECRET) return send({ error: "Admin-Anmeldung ist noch nicht konfiguriert." }, 503);
      let body = {};
      try { body = await request.json(); } catch {}
      const attempt = enc.encode(String(body.password || ""));
      const expected = enc.encode(env.ADMIN_PASSWORD);
      let diff = attempt.length ^ expected.length;
      for (let i = 0; i < Math.max(attempt.length, expected.length); i++) diff |= (attempt[i] || 0) ^ (expected[i] || 0);
      if (diff) return send({ error: "Passwort falsch." }, 401);
      return send({ ok: true, token: await issue(env.SESSION_SECRET) });
    }
    if (url.pathname === "/api/session" && request.method === "GET") {
      return send({ authenticated: await valid(bearer(request), env.SESSION_SECRET) });
    }
    if (url.pathname === "/api/logout" && request.method === "POST") return send({ ok: true });


    if (url.pathname === "/api/tree" && request.method === "GET") {
      if (!await valid(bearer(request), env.SESSION_SECRET)) return send({ error: "Sitzung abgelaufen. Bitte erneut anmelden." }, 401);
      if (!env.GITHUB_TOKEN) return send({ error: "GitHub-Zugriff ist nicht konfiguriert." }, 503);
      const path = url.searchParams.get("path") || "";
      if (!safeFolderPath(path) || !visiblePath(path)) return send({ error: "Dieser Ordner darf nicht angezeigt werden." }, 400);
      try {
        if (url.searchParams.get("all") === "1") {
          const apiHeaders = {
            "Authorization": "Bearer " + env.GITHUB_TOKEN,
            "Accept": "application/vnd.github+json",
            "X-GitHub-Api-Version": "2022-11-28",
            "User-Agent": "Neuvia-Admin-Editor",
          };
          const branchResponse = await fetch(API + "/repos/" + OWNER + "/" + REPO + "/branches/" + encodeURIComponent(BRANCH), {
            headers: apiHeaders,
          });
          const branchData = await branchResponse.json().catch(() => ({}));
          if (!branchResponse.ok) throw new Error("GitHub-API Fehler " + branchResponse.status + ": " + (branchData.message || branchResponse.statusText));
          const treeSha = branchData.commit?.commit?.tree?.sha;
          if (!treeSha) throw new Error("GitHub hat keine Tree-SHA für den Test-Branch geliefert.");
          const treeResponse = await fetch(API + "/repos/" + OWNER + "/" + REPO + "/git/trees/" + treeSha + "?recursive=1", {
            headers: apiHeaders,
          });
          const treeData = await treeResponse.json().catch(() => ({}));
          if (!treeResponse.ok) throw new Error("GitHub-API Fehler " + treeResponse.status + ": " + (treeData.message || treeResponse.statusText));
          if (treeData.truncated) throw new Error("GitHub hat die Dateiliste gekürzt. Bitte Ordner einzeln laden.");
          const items = (treeData.tree || [])
            .filter((entry) => visiblePath(entry.path) && (entry.type === "tree" || (entry.type === "blob" && visibleFile(entry.path))))
            .map((entry) => ({
              name: entry.path.split("/").pop(),
              path: entry.path,
              type: entry.type === "tree" ? "folder" : "file",
              extension: entry.type === "blob" ? entry.path.split(".").pop().toLowerCase() : "",
              size: entry.size || null,
            }));
          return send({ path: "", items });
        }
        const result = await fetch(githubUrl(path) + "?ref=" + encodeURIComponent(BRANCH), {
          headers: {
            "Authorization": "Bearer " + env.GITHUB_TOKEN,
            "Accept": "application/vnd.github+json",
            "X-GitHub-Api-Version": "2022-11-28",
            "User-Agent": "Neuvia-Admin-Editor",
          },
        });
        const raw = await result.text();
        let entries;
        try { entries = JSON.parse(raw); } catch { entries = null; }
        if (!result.ok) throw new Error("GitHub-API Fehler " + result.status + ": " + (entries?.message || result.statusText));
        if (!Array.isArray(entries)) throw new Error("GitHub hat für diesen Pfad keinen Ordner geliefert.");
        const items = entries
          .filter((entry) => visiblePath(entry.path) && (entry.type === "dir" || (entry.type === "file" && visibleFile(entry.path))))
          .map((entry) => ({
            name: entry.name,
            path: entry.path,
            type: entry.type === "dir" ? "folder" : "file",
            extension: entry.type === "file" ? entry.name.split(".").pop().toLowerCase() : "",
            size: entry.type === "file" ? entry.size : null,
          }))
          .sort((a, b) => a.type === b.type
            ? a.name.localeCompare(b.name, "de", { sensitivity: "base", numeric: true })
            : (a.type === "folder" ? -1 : 1));
        return send({ path, items });
      } catch (error) {
        return send({ error: error.message }, 502);
      }
    }

    if (url.pathname === "/api/file" && request.method === "GET") {
      if (!await valid(bearer(request), env.SESSION_SECRET)) return send({ error: "Sitzung abgelaufen. Bitte erneut anmelden." }, 401);
      if (!env.GITHUB_TOKEN) return send({ error: "GitHub-Zugriff ist nicht konfiguriert." }, 503);
      const path = url.searchParams.get("path") || "";
      if (!safePath(path) || !visiblePath(path)) return send({ error: "Dieser Dateipfad darf nicht bearbeitet werden." }, 400);
      try {
        const file = await readFile(path, env.GITHUB_TOKEN);
        return send({ path, content: file.content, sha: file.sha });
      } catch (error) {
        return send({ error: error.message }, 502);
      }
    }

    if (url.pathname === "/api/save" && request.method === "POST") {
      if (!await valid(bearer(request), env.SESSION_SECRET)) return send({ error: "Sitzung abgelaufen. Bitte erneut anmelden." }, 401);
      if (!env.GITHUB_TOKEN) return send({ error: "GitHub-Zugriff ist nicht konfiguriert." }, 503);
      let body = {};
      try { body = JSON.parse(await request.text()); } catch { return send({ error: "Ungültige Anfrage." }, 400); }
      const path = body.path;
      const content = body.content;
      const message = String(body.message || "Neuvia-Seite aktualisiert").trim();
      if (!safePath(path) || !visiblePath(path)) return send({ error: "Dieser Dateipfad darf nicht bearbeitet werden." }, 400);
      if (typeof content !== "string" || enc.encode(content).length > 900000) return send({ error: "Der Inhalt ist zu groß für diesen Editor." }, 400);
      if (message.length < 3 || message.length > 100) return send({ error: "Die Commit-Nachricht muss 3 bis 100 Zeichen lang sein." }, 400);

      try {
        const current = await readFile(path, env.GITHUB_TOKEN);
        if (body.sha && body.sha !== current.sha) {
          return send({ error: "Diese Notiz wurde zwischenzeitlich geändert. Lade sie neu, bevor du weiter synchronisierst." }, 409);
        }
        if (current.content === content) {
          return send({ ok: true, unchanged: true, commit: "", sha: current.sha });
        }
        const result = await fetch(githubUrl(path), {
          method: "PUT",
          headers: {
            "Authorization": "Bearer " + env.GITHUB_TOKEN,
            "Accept": "application/vnd.github+json",
            "X-GitHub-Api-Version": "2022-11-28",
            "User-Agent": "Neuvia-Admin-Editor",
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            message,
            content: encodeBase64(content),
            sha: current.sha,
            branch: BRANCH,
          }),
        });
        const data = await result.json().catch(() => ({}));
        if (!result.ok) {
          const detail = data.message || result.statusText || "Unbekannte GitHub-Antwort";
          const error = result.status === 409 || result.status === 422
            ? "Die Datei wurde zwischenzeitlich geändert. Bitte Seite neu laden und erneut versuchen."
            : "GitHub-API Fehler " + result.status + ": " + detail;
          return send({ error }, 502);
        }
        return send({ ok: true, commit: data.commit?.sha || "", sha: data.content?.sha || "" });
      } catch (error) {
        return send({ error: error.message }, 502);
      }
    }

    if (url.pathname === "/api/create" && request.method === "POST") {
      if (!await valid(bearer(request), env.SESSION_SECRET)) return send({ error: "Sitzung abgelaufen. Bitte erneut anmelden." }, 401);
      if (!env.GITHUB_TOKEN) return send({ error: "GitHub-Zugriff ist nicht konfiguriert." }, 503);
      let body = {};
      try { body = JSON.parse(await request.text()); } catch { return send({ error: "Ungültige Anfrage." }, 400); }
      const path = body.path;
      const content = typeof body.content === "string" ? body.content : "";
      if (!safePath(path) || !visiblePath(path)) return send({ error: "Dieser Dateipfad darf nicht verwendet werden." }, 400);
      if (enc.encode(content).length > 900000) return send({ error: "Der Inhalt ist zu groß." }, 400);
      try {
        const data = await githubContentsWrite(path, {
          message: "Neuvia-Notiz erstellt",
          content: encodeBase64(content),
        }, env.GITHUB_TOKEN);
        return send({ ok: true, path, commit: data.commit?.sha || "", sha: data.content?.sha || "" });
      } catch (error) {
        return send({ error: error.message }, 502);
      }
    }

    if (url.pathname === "/api/upload" && request.method === "POST") {
      if (!await valid(bearer(request), env.SESSION_SECRET)) return send({ error: "Sitzung abgelaufen. Bitte erneut anmelden." }, 401);
      if (!env.GITHUB_TOKEN) return send({ error: "GitHub-Zugriff ist nicht konfiguriert." }, 503);
      try {
        const form = await request.formData();
        const file = form.get("file");
        if (!file || typeof file.arrayBuffer !== "function") return send({ error: "Keine Bilddatei empfangen." }, 400);
        if (!file.size || file.size > 10 * 1024 * 1024) return send({ error: "Bilder dürfen höchstens 10 MB groß sein." }, 400);
        const filename = safeUploadFilename(file.name);
        const extension = filename.split(".").pop().toLowerCase();
        if (!MIME_BY_EXTENSION[extension].includes(file.type)) return send({ error: "Dateiendung und Bildformat passen nicht zusammen." }, 400);
        const now = new Date();
        const stamp = now.getUTCFullYear().toString()
          + String(now.getUTCMonth() + 1).padStart(2, "0")
          + String(now.getUTCDate()).padStart(2, "0")
          + String(now.getUTCHours()).padStart(2, "0")
          + String(now.getUTCMinutes()).padStart(2, "0")
          + String(now.getUTCSeconds()).padStart(2, "0");
        const bytes = new Uint8Array(await file.arrayBuffer());
        const content = encodeBase64Bytes(bytes);
        let path = "";
        let data = null;
        for (let attempt = 0; attempt < 5; attempt++) {
          path = "Files/" + stamp + "-" + crypto.randomUUID().slice(0, 8) + "-" + filename;
          try {
            data = await githubContentsWrite(path, {
              message: "Bild hochgeladen: " + filename.slice(0, 70),
              content,
            }, env.GITHUB_TOKEN);
            break;
          } catch (error) {
            if ((error.status === 409 || error.status === 422) && attempt < 4) continue;
            throw error;
          }
        }
        if (!data) throw new Error("Für das Bild konnte kein freier Dateiname gefunden werden.");
        return send({
          ok: true,
          path,
          embed: "![[" + path + "]]",
          commit: data.commit?.sha || "",
          size: file.size,
        });
      } catch (error) {
        return send({ error: error.message || "Bild konnte nicht hochgeladen werden." }, 502);
      }
    }



    if (url.pathname === "/api/move" && request.method === "POST") {
      if (!await valid(bearer(request), env.SESSION_SECRET)) return send({ error: "Sitzung abgelaufen. Bitte erneut anmelden." }, 401);
      if (!env.GITHUB_TOKEN) return send({ error: "GitHub-Zugriff ist nicht konfiguriert." }, 503);
      let body = {};
      try { body = JSON.parse(await request.text()); } catch { return send({ error: "Ungültige Anfrage." }, 400); }
      const source = String(body.source || "").replace(/\/+$/, "");
      const destination = String(body.destination || "").replace(/\/+$/, "");
      if (!source || !destination || source === destination) return send({ error: "Bitte unterschiedliche Quell- und Zielpfade angeben." }, 400);
      if (!safeFolderPath(source) || !safeFolderPath(destination) || !visiblePath(source) || !visiblePath(destination)) {
        return send({ error: "Dieser Datei- oder Ordnerpfad darf nicht verschoben werden." }, 400);
      }
      try {
        const result = await moveVaultPath(source, destination, env.GITHUB_TOKEN);
        return send({ ok: true, source, destination, commit: result.commit, movedFiles: result.count, folder: result.isFolder, rewrittenNotes: result.rewrittenNotes || 0 });
      } catch (error) {
        const status = /zwischenzeitlich|Ziel|Quelle|nicht verschoben|in sich selbst|Dateiendung|ausgeblendete|Submodul/i.test(error.message) ? 409 : 502;
        return send({ error: error.message }, status);
      }
    }


    if (url.pathname === "/api/delete" && request.method === "POST") {
      if (!await valid(bearer(request), env.SESSION_SECRET)) return send({ error: "Sitzung abgelaufen. Bitte erneut anmelden." }, 401);
      if (!env.GITHUB_TOKEN) return send({ error: "GitHub-Zugriff ist nicht konfiguriert." }, 503);
      let body = {};
      try { body = JSON.parse(await request.text()); } catch { return send({ error: "Ungültige Anfrage." }, 400); }
      const path = String(body.path || "").replace(/\/+$/, "");
      const mode = String(body.mode || "");
      if (!path || !["file", "recursive", "contents"].includes(mode)) return send({ error: "Ungültiger Löschauftrag." }, 400);
      try {
        const result = await deleteVaultPath(path, mode, env.GITHUB_TOKEN);
        return send({ ok: true, path, mode, commit: result.commit, changedFiles: result.count });
      } catch (error) {
        const status = /existiert nicht|Zielkonflikt|ausgeblendete|Ungültiger|keine Dateien/i.test(error.message) ? 409 : 502;
        return send({ error: error.message }, status);
      }
    }

    if (url.pathname === "/api/publish-status" && request.method === "GET") {
      if (!await valid(bearer(request), env.SESSION_SECRET)) return send({ error: "Sitzung abgelaufen. Bitte erneut anmelden." }, 401);
      if (!env.GITHUB_TOKEN) return send({ error: "GitHub-Zugriff ist nicht konfiguriert." }, 503);
      const commit = String(url.searchParams.get("commit") || "");
      if (!/^[a-f0-9]{40}$/i.test(commit)) return send({ error: "Ungültiger Veröffentlichungs-Commit." }, 400);
      try {
        const result = await githubJson("/repos/" + OWNER + "/" + REPO + "/actions/runs?branch=" + encodeURIComponent(BRANCH) + "&head_sha=" + encodeURIComponent(commit) + "&per_page=5", env.GITHUB_TOKEN);
        const run = (result.workflow_runs || []).find((item) => item.head_sha === commit);
        if (!run) return send({ found: false, status: "queued", conclusion: null, url: "" });
        return send({ found: true, status: run.status || "unknown", conclusion: run.conclusion || null, url: run.html_url || "" });
      } catch (error) {
        return send({ error: error.message || "Veröffentlichungsstatus konnte nicht gelesen werden." }, 502);
      }
    }

    if (url.pathname === "/api/publish" && request.method === "POST") {
      if (!await valid(bearer(request), env.SESSION_SECRET)) return send({ error: "Sitzung abgelaufen. Bitte erneut anmelden." }, 401);
      if (!env.GITHUB_TOKEN) return send({ error: "GitHub-Zugriff ist nicht konfiguriert." }, 503);
      const triggerPath = ".github/neuvia-publish-trigger.json";
      try {
        const check = await fetch(githubUrl(triggerPath) + "?ref=" + encodeURIComponent(BRANCH), {
          headers: {
            "Authorization": "Bearer " + env.GITHUB_TOKEN,
            "Accept": "application/vnd.github+json",
            "X-GitHub-Api-Version": "2022-11-28",
            "User-Agent": "Neuvia-Admin-Editor",
          },
        });
        let existing = {};
        if (check.ok) existing = await check.json();
        else if (check.status !== 404) throw new Error("GitHub konnte den Veröffentlichungsstatus nicht prüfen (HTTP " + check.status + ").");
        const payload = JSON.stringify({ requestedAt: new Date().toISOString(), branch: BRANCH });
        const data = await githubContentsWrite(triggerPath, {
          message: "Neuvia: Veröffentlichung angefordert",
          content: encodeBase64(payload),
          ...(existing.sha ? { sha: existing.sha } : {}),
        }, env.GITHUB_TOKEN);
        return send({ ok: true, commit: data.commit?.sha || "" });
      } catch (error) {
        return send({ error: error.message || "Veröffentlichung konnte nicht gestartet werden." }, 502);
      }
    }

    return send({ error: "Not found" }, 404);
  },
};

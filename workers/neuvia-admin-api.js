const ORIGIN = "https://elrayo23.github.io";
const ORIGINS = [ORIGIN, "https://neuvia-editor-preview.pages.dev"];
const OWNER = "ElRayo23";
const REPO = "Neuvia";
const BRANCH = "neuvia-editor-test";
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
  if (typeof path !== "string" || path.length > 500 || !path.endsWith(".md") || path.startsWith("/") || path.includes("\\")) return false;
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
    throw new Error((result.status === 409 || result.status === 422)
      ? "Die Datei konnte nicht gespeichert werden, weil sie bereits existiert oder zwischenzeitlich geändert wurde."
      : "GitHub-API Fehler " + result.status + ": " + detail);
  }
  return data;
}
function safeUploadFilename(filename) {
  const original = String(filename || "bild").normalize("NFC").split(/[\\\\/]/).pop();
  const dot = original.lastIndexOf(".");
  if (dot <= 0) throw new Error("Die Bilddatei braucht eine gültige Dateiendung.");
  const extension = original.slice(dot + 1).toLowerCase();
  if (!IMAGE_EXTENSIONS.has(extension)) throw new Error("Erlaubt sind PNG, JPG, WebP, GIF und AVIF.");
  const stem = original.slice(0, dot)
    .replace(/[^\\p{L}\\p{N}._-]+/gu, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/^\\.+/, "")
    .slice(0, 100);
  if (!stem) throw new Error("Der Bildname ist ungültig.");
  return stem + "." + extension;
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
      if (!safePath(path)) return send({ error: "Dieser Dateipfad darf nicht bearbeitet werden." }, 400);
      try {
        const file = await readFile(path, env.GITHUB_TOKEN);
        return send({ path, content: file.content });
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
      if (!safePath(path)) return send({ error: "Dieser Dateipfad darf nicht bearbeitet werden." }, 400);
      if (typeof content !== "string" || enc.encode(content).length > 900000) return send({ error: "Der Inhalt ist zu groß für diesen Editor." }, 400);
      if (message.length < 3 || message.length > 100) return send({ error: "Die Commit-Nachricht muss 3 bis 100 Zeichen lang sein." }, 400);

      try {
        const current = await readFile(path, env.GITHUB_TOKEN);
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
        return send({ ok: true, commit: data.commit?.sha || "" });
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
        return send({ ok: true, path, commit: data.commit?.sha || "" });
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
        const path = "Files/" + stamp + "-" + crypto.randomUUID().slice(0, 8) + "-" + filename;
        const bytes = new Uint8Array(await file.arrayBuffer());
        const data = await githubContentsWrite(path, {
          message: "Bild hochgeladen: " + filename.slice(0, 70),
          content: encodeBase64Bytes(bytes),
        }, env.GITHUB_TOKEN);
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

    return send({ error: "Not found" }, 404);
  },
};

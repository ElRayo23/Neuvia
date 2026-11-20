(() => {
  "use strict";
  if (window.__neuviaMoodLoaded) return;
  window.__neuviaMoodLoaded = true;

  const API = "https://neuvia-admin-api.forkleafcustom.workers.dev";
  const SESSION_KEY = "neuviaAdminSession";
  const STATIC_BASE = new URL("/static/", window.location.origin).href;
  const VIDEO_EXTENSIONS = new Set(["webm", "mp4", "m4v", "mov", "ogv"]);
  const IMAGE_EXTENSIONS = new Set(["png", "jpg", "jpeg", "webp", "gif", "avif"]);
  const $ = (root, selector) => root.querySelector(selector);
  const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  })[char]);

  const token = () => sessionStorage.getItem(SESSION_KEY) || "";

  function getExtension(value) {
    try {
      const pathname = new URL(String(value || ""), window.location.href).pathname;
      return pathname.split(".").pop().toLowerCase();
    } catch {
      return String(value || "").split("?")[0].split(".").pop().toLowerCase();
    }
  }

  function isVideo(value, type) {
    return type === "video" || VIDEO_EXTENSIONS.has(getExtension(value));
  }

  function resolveMedia(value) {
    const raw = String(value || "").trim();
    if (!raw) return "";
    if (/^https?:\/\//i.test(raw)) return raw;
    if (/^(data:|blob:)/i.test(raw)) return raw;
    if (/^\/\//.test(raw)) return window.location.protocol + raw;
    if (/^(files|assets)\//i.test(raw)) {
      return API + "/api/public-asset?path=" + encodeURIComponent(raw);
    }
    return new URL(raw, window.location.href).href;
  }

  function yamlValue(value) {
    const raw = String(value ?? "").trim();
    if (!raw) return "";
    try { return JSON.parse(raw); } catch {}
    return raw.replace(/^['"]|['"]$/g, "");
  }

  function parseFrontmatter(source) {
    const match = /^---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/.exec(String(source || ""));
    if (!match) return {};
    const result = {};
    let listKey = "";
    for (const line of match[1].split(/\r?\n/)) {
      const listMatch = /^\s+-\s+(.+)$/.exec(line);
      if (listMatch && listKey) {
        result[listKey].push(yamlValue(listMatch[1]));
        continue;
      }
      const fieldMatch = /^([A-Za-z][\w-]*):\s*(.*)$/.exec(line);
      if (!fieldMatch) continue;
      listKey = "";
      const key = fieldMatch[1];
      const value = fieldMatch[2].trim();
      if (key === "tags" && !value) {
        result.tags = [];
        listKey = "tags";
      } else if (value.startsWith("[") && value.endsWith("]")) {
        try { result[key] = JSON.parse(value); }
        catch { result[key] = value.slice(1, -1).split(",").map((item) => yamlValue(item)); }
      } else {
        result[key] = yamlValue(value);
      }
    }
    return result;
  }

  function makeNote(entry) {
    const lines = [
      "---",
      "title: " + JSON.stringify(entry.title),
      "moodType: " + JSON.stringify(entry.moodType),
      "category: " + JSON.stringify(entry.category || ""),
      "mediaType: " + JSON.stringify(entry.mediaType),
      "source: " + JSON.stringify(entry.source || ""),
      "media: " + JSON.stringify(entry.media),
      "preview: " + JSON.stringify(entry.preview || "")
    ];
    if (entry.tags?.length) {
      lines.push("tags:");
      for (const tag of entry.tags) lines.push("  - " + JSON.stringify(tag));
    } else {
      lines.push("tags: []");
    }
    lines.push("---", "");
    return lines.join("\n");
  }

  function slugify(value) {
    return String(value || "").normalize("NFKD").replace(/[\u0300-\u036f]/g, "")
      .replace(/ß/g, "ss").toLowerCase().replace(/&/g, " and ")
      .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 70);
  }

  async function apiJson(path, options) {
    const headers = { ...(options?.headers || {}) };
    if (token()) headers.Authorization = "Bearer " + token();
    if (options?.json) headers["Content-Type"] = "text/plain;charset=UTF-8";
    const response = await fetch(API + path, {
      method: options?.method || "GET",
      headers,
      body: options?.body
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || "Anfrage fehlgeschlagen (HTTP " + response.status + ").");
    return data;
  }

  async function fetchNote(path) {
    const data = await apiJson("/api/public-note?path=" + encodeURIComponent(path));
    return parseFrontmatter(data.content);
  }

  async function loadEntries() {
    const response = await fetch(STATIC_BASE + "neuvia-link-index.json?v=" + Date.now(), { cache: "no-store" });
    if (!response.ok) throw new Error("Der Mood-Index konnte nicht geladen werden.");
    const links = await response.json();
    const candidates = links.filter((item) => {
      const path = String(item.path || "");
      return /^Mood\/(Maps|Scenes)\//i.test(path) && /\.md$/i.test(path);
    });
    const entries = [];
    for (let index = 0; index < candidates.length; index += 6) {
      const batch = candidates.slice(index, index + 6);
      const results = await Promise.all(batch.map(async (item) => {
        try {
          const meta = await fetchNote(item.path);
          if (!meta.media) return null;
          return {
            path: item.path,
            title: meta.title || item.title || item.path.split("/").pop().replace(/\.md$/i, ""),
            moodType: String(meta.moodType || (item.path.includes("/Scenes/") ? "Scene" : "Map")),
            category: String(meta.category || ""),
            mediaType: String(meta.mediaType || (isVideo(meta.media) ? "video" : "image")),
            source: String(meta.source || ""),
            media: String(meta.media || ""),
            preview: String(meta.preview || ""),
            tags: Array.isArray(meta.tags) ? meta.tags.map(String) : []
          };
        } catch {
          return null;
        }
      }));
      entries.push(...results.filter(Boolean));
    }
    return entries.sort((a, b) => a.title.localeCompare(b.title, "de", { sensitivity: "base" }));
  }

  function status(root, message, error) {
    const target = $(root, ".nm-status");
    if (!target) return;
    target.textContent = message || "";
    target.classList.toggle("nm-error", Boolean(error));
  }

  function buildStyles() {
    if (document.getElementById("neuvia-mood-styles")) return;
    const style = document.createElement("style");
    style.id = "neuvia-mood-styles";
    style.textContent = `
      #neuvia-mood, #neuvia-mood-player { color: var(--dark); }
      #neuvia-mood .nm-heading { margin: 0 0 4px; }
      #neuvia-mood .nm-subtitle { color: var(--darkgray); margin: 0 0 16px; }
      #neuvia-mood .nm-toolbar, #neuvia-mood .nm-actions { display:flex; flex-wrap:wrap; gap:9px; align-items:center; margin:12px 0; }
      #neuvia-mood input, #neuvia-mood select, #neuvia-mood button { font:inherit; }
      #neuvia-mood input, #neuvia-mood select { box-sizing:border-box; min-width:0; max-width:100%; padding:9px 10px; color:var(--dark); background:var(--light); border:1px solid var(--gray); border-radius:7px; }
      #neuvia-mood .nm-search { flex:1 1 220px; }
      #neuvia-mood button { padding:9px 13px; border:1px solid var(--gray); border-radius:7px; background:var(--light); color:var(--dark); cursor:pointer; }
      #neuvia-mood button:hover { border-color:var(--secondary); }
      #neuvia-mood button:disabled { cursor:not-allowed; opacity:.5; }
      #neuvia-mood .nm-primary { background:var(--secondary); color:white; border-color:var(--secondary); }
      #neuvia-mood .nm-auth-note, #neuvia-mood .nm-status { color:var(--darkgray); font-size:.9em; margin:8px 0; min-height:1.3em; }
      #neuvia-mood .nm-status.nm-error { color:#bd4040; }
      #neuvia-mood .nm-form { border:1px solid var(--lightgray); border-radius:10px; padding:14px; margin:14px 0; background:var(--highlight); }
      #neuvia-mood .nm-form h3 { margin:0 0 12px; }
      #neuvia-mood .nm-fields { display:grid; grid-template-columns:repeat(auto-fit,minmax(190px,1fr)); gap:10px; }
      #neuvia-mood .nm-field { display:flex; flex-direction:column; gap:5px; min-width:0; }
      #neuvia-mood .nm-field label { font-size:.85em; color:var(--darkgray); }
      #neuvia-mood .nm-field input, #neuvia-mood .nm-field select { width:100%; }
      #neuvia-mood .nm-form-actions { display:flex; flex-wrap:wrap; gap:8px; margin-top:12px; }
      #neuvia-mood .nm-grid { display:grid; grid-template-columns:repeat(auto-fill,minmax(min(100%,235px),1fr)); gap:14px; margin-top:16px; }
      #neuvia-mood .nm-card { overflow:hidden; border:1px solid var(--lightgray); border-radius:10px; background:var(--light); min-width:0; }
      #neuvia-mood .nm-preview { position:relative; display:flex; align-items:center; justify-content:center; aspect-ratio:16/10; overflow:hidden; background:#15171b; }
      #neuvia-mood .nm-preview img, #neuvia-mood .nm-preview video { display:block; width:100%; height:100%; object-fit:cover; }
      #neuvia-mood .nm-preview .nm-preview-badge { position:absolute; left:9px; top:9px; border-radius:5px; padding:3px 7px; color:white; background:#0009; font-size:11px; }
      #neuvia-mood .nm-card-body { padding:11px 12px 12px; }
      #neuvia-mood .nm-card-title { font-weight:650; line-height:1.3; margin:0 0 5px; }
      #neuvia-mood .nm-card-meta { color:var(--darkgray); font-size:.82em; margin:0 0 8px; }
      #neuvia-mood .nm-tags { display:flex; flex-wrap:wrap; gap:5px; margin:7px 0 9px; }
      #neuvia-mood .nm-tag { border:1px solid var(--lightgray); border-radius:99px; padding:2px 7px; font-size:11px; color:var(--darkgray); }
      #neuvia-mood .nm-card-actions { display:flex; justify-content:flex-end; }
      #neuvia-mood .nm-empty { padding:22px 12px; border:1px dashed var(--gray); border-radius:9px; text-align:center; color:var(--darkgray); }
      #neuvia-mood-player { position:fixed; inset:0; z-index:2147483000; width:100vw; height:100vh; height:100dvh; margin:0; padding:0; background:#07080b; color:white; }
      #neuvia-mood-player .nm-player { position:absolute; inset:0; display:flex; flex-direction:column; }
      #neuvia-mood-player .nm-player-bar { z-index:2; display:flex; justify-content:space-between; align-items:center; gap:12px; padding:10px 14px; background:linear-gradient(#000b,#0000); }
      #neuvia-mood-player .nm-player-title { min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; font-weight:600; }
      #neuvia-mood-player .nm-player-buttons { display:flex; gap:7px; flex-shrink:0; }
      #neuvia-mood-player button { border:1px solid #ffffff55; border-radius:7px; color:white; background:#17191dcc; padding:8px 10px; cursor:pointer; }
      #neuvia-mood-player .nm-stage { flex:1; min-height:0; display:flex; align-items:center; justify-content:center; overflow:hidden; }
      #neuvia-mood-player .nm-stage img, #neuvia-mood-player .nm-stage video { display:block; width:100%; height:100%; object-fit:contain; }
      #neuvia-mood-player .nm-player-message { color:#ddd; padding:24px; text-align:center; }
      body.neuvia-mood-player-page { overflow:hidden !important; }
      @media (max-width:600px) {
        #neuvia-mood .nm-grid { grid-template-columns:repeat(2,minmax(0,1fr)); gap:9px; }
        #neuvia-mood .nm-card-body { padding:9px; }
      }
    `;
    document.head.appendChild(style);
  }

  function openPlayer(entry) {
    const url = new URL("/mood/player", window.location.origin);
    url.searchParams.set("path", entry.path);
    window.open(url.href, "_blank");
  }

  function renderPreview(entry) {
    const previewValue = entry.preview || entry.media;
    const previewUrl = resolveMedia(previewValue);
    if (!previewUrl) return '<div class="nm-preview"><span class="nm-preview-badge">Keine Vorschau</span></div>';
    if (isVideo(previewValue)) {
      return '<div class="nm-preview"><video muted loop playsinline preload="none" data-nm-preview="' + esc(previewUrl) + '"></video><span class="nm-preview-badge">Animation</span></div>';
    }
    return '<div class="nm-preview"><img loading="lazy" src="' + esc(previewUrl) + '" alt="' + esc(entry.title) + '"><span class="nm-preview-badge">' + (entry.moodType === "Scene" ? "Scene" : "Map") + '</span></div>';
  }

  function mountLibrary(root) {
    buildStyles();
    root.innerHTML = [
      '<div class="nm-library">',
      '<h2 class="nm-heading">Mood</h2>',
      '<p class="nm-subtitle">Maps und Scenes für deine Spielrunden. Doppelklick auf eine Vorschau öffnet sie in einem eigenen Vollbild-Tab.</p>',
      '<div class="nm-toolbar">',
      '<input class="nm-search" type="search" placeholder="Name, Kategorie oder Tag suchen …" aria-label="Mood durchsuchen">',
      '<select class="nm-type" aria-label="Art filtern"><option value="">Maps und Scenes</option><option value="Map">Maps</option><option value="Scene">Scenes</option></select>',
      '<select class="nm-category" aria-label="Kategorie filtern"><option value="">Alle Kategorien</option></select>',
      '<select class="nm-media-type" aria-label="Medienart filtern"><option value="">Alle Medien</option><option value="video">Animationen</option><option value="image">Bilder</option></select>',
      '</div>',
      '<div class="nm-actions">',
      '<button type="button" class="nm-primary" data-nm-action="external">+ Externe Map / Scene</button>',
      '<button type="button" data-nm-action="upload">+ Eigenes Bild hochladen</button>',
      '</div>',
      '<p class="nm-auth-note"></p>',
      '<div class="nm-form-slot"></div>',
      '<p class="nm-status" role="status" aria-live="polite">Lade Mood-Bibliothek …</p>',
      '<div class="nm-grid"></div>',
      '</div>'
    ].join("");

    let entries = [];
    const grid = $(root, ".nm-grid");
    const search = $(root, ".nm-search");
    const typeFilter = $(root, ".nm-type");
    const categoryFilter = $(root, ".nm-category");
    const mediaFilter = $(root, ".nm-media-type");
    const formSlot = $(root, ".nm-form-slot");
    const authNote = $(root, ".nm-auth-note");
    const buttons = root.querySelectorAll("[data-nm-action]");

    async function refreshAuth() {
      let authenticated = false;
      if (token()) {
        try {
          const data = await apiJson("/api/session");
          authenticated = Boolean(data.authenticated);
        } catch {}
      }
      buttons.forEach((button) => { button.disabled = !authenticated; });
      authNote.textContent = authenticated
        ? "Administrator angemeldet – du kannst Medien hinzufügen."
        : "Zum Hinzufügen oder Hochladen oben rechts über „Bearbeiten“ anmelden.";
    }

    function refreshCategories() {
      const current = categoryFilter.value;
      const categories = Array.from(new Set(entries.map((entry) => entry.category).filter(Boolean)))
        .sort((a, b) => a.localeCompare(b, "de", { sensitivity: "base" }));
      categoryFilter.innerHTML = '<option value="">Alle Kategorien</option>' +
        categories.map((category) => '<option value="' + esc(category) + '">' + esc(category) + '</option>').join("");
      categoryFilter.value = categories.includes(current) ? current : "";
    }

    function draw() {
      const query = search.value.trim().toLocaleLowerCase("de");
      const wantedType = typeFilter.value;
      const wantedCategory = categoryFilter.value;
      const wantedMedia = mediaFilter.value;
      const visible = entries.filter((entry) => {
        const haystack = [entry.title, entry.category, entry.source, ...(entry.tags || [])].join(" ").toLocaleLowerCase("de");
        return (!query || haystack.includes(query))
          && (!wantedType || entry.moodType === wantedType)
          && (!wantedCategory || entry.category === wantedCategory)
          && (!wantedMedia || entry.mediaType === wantedMedia);
      });
      if (!visible.length) {
        grid.innerHTML = '<div class="nm-empty">' + (entries.length
          ? "Keine passenden Maps oder Scenes gefunden."
          : "Noch keine Einträge vorhanden. Füge oben eine externe URL oder ein eigenes Bild hinzu.") + '</div>';
        status(root, entries.length ? "0 Treffer" : "Die Bibliothek ist bereit.");
        return;
      }
      grid.innerHTML = visible.map((entry) => {
        const tags = (entry.tags || []).slice(0, 5).map((tag) => '<span class="nm-tag">' + esc(tag) + '</span>').join("");
        const meta = [entry.moodType || "Map", entry.category, entry.source].filter(Boolean).join(" · ");
        return '<article class="nm-card" tabindex="0" role="button" data-nm-open="' + esc(entry.path) + '" title="Doppelklick zum Öffnen">' +
          renderPreview(entry) +
          '<div class="nm-card-body">' +
          '<p class="nm-card-title">' + esc(entry.title) + '</p>' +
          '<p class="nm-card-meta">' + esc(meta) + '</p>' +
          (tags ? '<div class="nm-tags">' + tags + '</div>' : '') +
          '<div class="nm-card-actions"><button type="button" data-nm-open-button="' + esc(entry.path) + '">Öffnen ↗</button></div>' +
          '</div></article>';
      }).join("");
      status(root, visible.length + " von " + entries.length + " Einträgen");
      startPreviewVideos(grid);
    }

    function startPreviewVideos(container) {
      const videos = Array.from(container.querySelectorAll("video[data-nm-preview]"));
      for (const video of videos) video.src = video.dataset.nmPreview;
      if (!videos.length) return;
      if (!("IntersectionObserver" in window)) {
        videos.forEach((video) => video.play().catch(() => {}));
        return;
      }
      const observer = new IntersectionObserver((changes) => {
        for (const change of changes) {
          const video = change.target;
          if (change.isIntersecting) video.play().catch(() => {});
          else video.pause();
        }
      }, { rootMargin: "120px" });
      videos.forEach((video) => observer.observe(video));
    }

    function showForm(mode) {
      if (!token()) {
        status(root, "Bitte zuerst oben rechts über „Bearbeiten“ anmelden.", true);
        return;
      }
      if (mode === "external") {
        formSlot.innerHTML = [
          '<form class="nm-form" id="nm-external-form">',
          '<h3>Externe Map oder Scene hinzufügen</h3>',
          '<div class="nm-fields">',
          '<div class="nm-field"><label>Name</label><input name="title" required maxlength="120" placeholder="z. B. Muniment Chamberlain – Opulent"></div>',
          '<div class="nm-field"><label>Art</label><select name="moodType"><option value="Map">Map</option><option value="Scene">Scene</option></select></div>',
          '<div class="nm-field"><label>Medienart</label><select name="mediaType"><option value="image">Bild</option><option value="video">Animation / Video</option></select></div>',
          '<div class="nm-field"><label>Kategorie</label><input name="category" maxlength="60" placeholder="z. B. Dungeon, Forest, Tavern"></div>',
          '<div class="nm-field"><label>Medien-URL</label><input name="media" type="url" required placeholder="https://…"></div>',
          '<div class="nm-field"><label>Vorschau-URL (optional)</label><input name="preview" type="url" placeholder="https://…"></div>',
          '<div class="nm-field"><label>Quelle</label><input name="source" maxlength="80" value="Czepeku"></div>',
          '<div class="nm-field"><label>Tags (mit Komma trennen)</label><input name="tags" placeholder="Dungeon, Indoor, Czepeku"></div>',
          '</div>',
          '<div class="nm-form-actions"><button type="submit" class="nm-primary">Eintrag speichern</button><button type="button" data-nm-cancel>Abbrechen</button></div>',
          '</form>'
        ].join("");
        const mediaInput = formSlot.querySelector('[name="media"]');
        const mediaType = formSlot.querySelector('[name="mediaType"]');
        mediaInput.addEventListener("input", () => {
          if (VIDEO_EXTENSIONS.has(getExtension(mediaInput.value))) mediaType.value = "video";
        });
      } else {
        formSlot.innerHTML = [
          '<form class="nm-form" id="nm-upload-form">',
          '<h3>Eigenes Bild hochladen</h3>',
          '<div class="nm-fields">',
          '<div class="nm-field"><label>Name</label><input name="title" required maxlength="120" placeholder="Name der Map oder Scene"></div>',
          '<div class="nm-field"><label>Art</label><select name="moodType"><option value="Map">Map</option><option value="Scene">Scene</option></select></div>',
          '<div class="nm-field"><label>Kategorie</label><input name="category" maxlength="60" placeholder="z. B. Dungeon, Forest, Tavern"></div>',
          '<div class="nm-field"><label>Bilddatei (PNG, JPG, WebP, GIF, AVIF; max. 10 MB)</label><input name="file" type="file" accept=".png,.jpg,.jpeg,.webp,.gif,.avif,image/png,image/jpeg,image/webp,image/gif,image/avif" required></div>',
          '<div class="nm-field"><label>Tags (mit Komma trennen)</label><input name="tags" placeholder="Dungeon, Night, Interior"></div>',
          '</div>',
          '<div class="nm-form-actions"><button type="submit" class="nm-primary">Bild hochladen und speichern</button><button type="button" data-nm-cancel>Abbrechen</button></div>',
          '</form>'
        ].join("");
      }
      formSlot.querySelector("[data-nm-cancel]").addEventListener("click", () => { formSlot.replaceChildren(); });
      const form = formSlot.querySelector("form");
      form.addEventListener("submit", async (event) => {
        event.preventDefault();
        const submit = form.querySelector('[type="submit"]');
        submit.disabled = true;
        try {
          if (mode === "external") {
            const data = new FormData(form);
            const title = String(data.get("title") || "").trim();
            const media = validateRemoteUrl(data.get("media"));
            const preview = String(data.get("preview") || "").trim()
              ? validateRemoteUrl(data.get("preview")) : "";
            const mediaTypeValue = String(data.get("mediaType") || "image");
            const entry = {
              title,
              moodType: String(data.get("moodType") || "Map"),
              mediaType: mediaTypeValue === "video" ? "video" : "image",
              category: String(data.get("category") || "").trim(),
              source: String(data.get("source") || "Extern").trim(),
              media,
              preview,
              tags: parseTags(data.get("tags"))
            };
            const path = await saveEntry(entry);
            entry.path = path;
            entries.push(entry);
            entries.sort((a, b) => a.title.localeCompare(b.title, "de", { sensitivity: "base" }));
            refreshCategories();
            draw();
            formSlot.replaceChildren();
            status(root, "Eintrag gespeichert: " + title);
          } else {
            const data = new FormData(form);
            const file = data.get("file");
            if (!file || !file.name) throw new Error("Bitte zuerst eine Bilddatei auswählen.");
            if (file.size > 10 * 1024 * 1024) throw new Error("Das Bild darf höchstens 10 MB groß sein.");
            if (!IMAGE_EXTENSIONS.has(getExtension(file.name))) throw new Error("Dieses Bildformat wird nicht unterstützt.");
            const uploaded = await uploadImage(file);
            const entry = {
              title: String(data.get("title") || "").trim(),
              moodType: String(data.get("moodType") || "Map"),
              mediaType: "image",
              category: String(data.get("category") || "").trim(),
              source: "Neuvia Upload",
              media: uploaded.path,
              preview: uploaded.path,
              tags: parseTags(data.get("tags"))
            };
            try {
              entry.path = await saveEntry(entry);
            } catch (error) {
              await deleteUploadedImage(uploaded.path).catch(() => {});
              throw error;
            }
            entries.push(entry);
            entries.sort((a, b) => a.title.localeCompare(b.title, "de", { sensitivity: "base" }));
            refreshCategories();
            draw();
            formSlot.replaceChildren();
            status(root, "Bild hochgeladen und gespeichert: " + entry.title);
          }
        } catch (error) {
          status(root, error.message || "Speichern fehlgeschlagen.", true);
          submit.disabled = false;
        }
      });
    }

    function validateRemoteUrl(value) {
      let url;
      try { url = new URL(String(value || "").trim()); }
      catch { throw new Error("Bitte eine gültige Medien-URL eingeben."); }
      if (url.protocol !== "https:" && url.protocol !== "http:") {
        throw new Error("Nur HTTP- und HTTPS-URLs sind erlaubt.");
      }
      return url.href;
    }

    function parseTags(value) {
      return Array.from(new Set(String(value || "").split(",").map((tag) => tag.trim()).filter(Boolean))).slice(0, 20);
    }

    async function saveEntry(entry) {
      const folder = entry.moodType === "Scene" ? "Mood/Scenes" : "Mood/Maps";
      const slug = slugify(entry.title) || "mood-eintrag";
      const path = folder + "/" + slug + "-" + Date.now().toString(36) + ".md";
      await apiJson("/api/create", {
        method: "POST",
        json: true,
        body: JSON.stringify({ path, content: makeNote(entry) })
      });
      return path;
    }

    async function uploadImage(file) {
      const form = new FormData();
      form.append("file", file, file.name);
      const response = await fetch(API + "/api/upload", {
        method: "POST",
        headers: { Authorization: "Bearer " + token() },
        body: form
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.path) throw new Error(data.error || "Bild-Upload fehlgeschlagen.");
      return data;
    }

    async function deleteUploadedImage(path) {
      return apiJson("/api/delete", {
        method: "POST",
        json: true,
        body: JSON.stringify({ path, mode: "file" })
      });
    }

    root.addEventListener("click", (event) => {
      const action = event.target.closest("[data-nm-action]");
      if (action) {
        showForm(action.dataset.nmAction);
        return;
      }
      if (event.target.closest("[data-nm-cancel]")) return;
      const openButton = event.target.closest("[data-nm-open-button]");
      if (openButton) {
        const entry = entries.find((item) => item.path === openButton.dataset.nmOpenButton);
        if (entry) openPlayer(entry);
      }
    });
    grid.addEventListener("dblclick", (event) => {
      if (event.target.closest("button")) return;
      const card = event.target.closest("[data-nm-open]");
      if (!card) return;
      const entry = entries.find((item) => item.path === card.dataset.nmOpen);
      if (entry) openPlayer(entry);
    });
    grid.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      const card = event.target.closest("[data-nm-open]");
      if (!card || event.target.closest("button")) return;
      event.preventDefault();
      const entry = entries.find((item) => item.path === card.dataset.nmOpen);
      if (entry) openPlayer(entry);
    });
    [search, typeFilter, categoryFilter, mediaFilter].forEach((control) => {
      control.addEventListener("input", draw);
      control.addEventListener("change", draw);
    });

    refreshAuth();
    loadEntries().then((loaded) => {
      entries = loaded;
      refreshCategories();
      draw();
    }).catch((error) => {
      grid.innerHTML = '<div class="nm-empty">Die Mood-Bibliothek konnte nicht geladen werden.</div>';
      status(root, error.message, true);
    });
  }

  async function mountPlayer(root) {
    buildStyles();
    document.body.classList.add("neuvia-mood-player-page");
    root.innerHTML = [
      '<div class="nm-player">',
      '<div class="nm-player-bar"><div class="nm-player-title">Mood</div>',
      '<div class="nm-player-buttons"><button type="button" data-nm-fullscreen>Vollbild</button><button type="button" data-nm-close>Zur Mood-Bibliothek</button></div></div>',
      '<div class="nm-stage"><div class="nm-player-message">Lade Medium …</div></div>',
      '</div>'
    ].join("");
    const title = $(root, ".nm-player-title");
    const stage = $(root, ".nm-stage");
    const params = new URLSearchParams(window.location.search);
    const path = params.get("path") || "";
    root.querySelector("[data-nm-fullscreen]").addEventListener("click", async () => {
      try {
        if (!document.fullscreenElement) await root.requestFullscreen();
        else await document.exitFullscreen();
      } catch {
        title.textContent = title.textContent + " (Vollbild nicht verfügbar)";
      }
    });
    root.querySelector("[data-nm-close]").addEventListener("click", () => {
      window.location.href = "/mood";
    });
    if (!path) {
      stage.innerHTML = '<div class="nm-player-message">Kein Mood-Eintrag angegeben.</div>';
      return;
    }
    try {
      const meta = await fetchNote(path);
      if (!meta.media) throw new Error("Für diesen Eintrag ist keine Medien-URL hinterlegt.");
      title.textContent = meta.title || path.split("/").pop().replace(/\.md$/i, "");
      stage.replaceChildren();
      const mediaUrl = resolveMedia(meta.media);
      if (isVideo(meta.media, String(meta.mediaType || ""))) {
        const video = document.createElement("video");
        video.src = mediaUrl;
        video.autoplay = true;
        video.loop = true;
        video.muted = true;
        video.playsInline = true;
        video.controls = true;
        video.preload = "auto";
        video.addEventListener("error", () => {
          stage.innerHTML = '<div class="nm-player-message">Das Video konnte nicht geladen werden. Prüfe die URL oder den Zugriff auf die Quelldatei.</div>';
        });
        stage.appendChild(video);
        video.play().catch(() => {});
      } else {
        const image = document.createElement("img");
        image.src = mediaUrl;
        image.alt = title.textContent;
        image.draggable = false;
        image.addEventListener("error", () => {
          stage.innerHTML = '<div class="nm-player-message">Das Bild konnte nicht geladen werden. Prüfe die URL oder den Zugriff auf die Quelldatei.</div>';
        });
        stage.appendChild(image);
      }
    } catch (error) {
      stage.innerHTML = '<div class="nm-player-message">' + esc(error.message) + '</div>';
    }
  }

  let mountQueued = false;
  function mountCurrentPage() {
    mountQueued = false;
    if (!document.getElementById("neuvia-mood-player")) document.body.classList.remove("neuvia-mood-player-page");
    const library = document.getElementById("neuvia-mood");
    if (library && library.dataset.moodMounted !== "yes") {
      library.dataset.moodMounted = "yes";
      mountLibrary(library);
    }
    const player = document.getElementById("neuvia-mood-player");
    if (player && player.dataset.moodMounted !== "yes") {
      player.dataset.moodMounted = "yes";
      mountPlayer(player);
    }
  }

  function scheduleMount() {
    if (mountQueued) return;
    mountQueued = true;
    setTimeout(mountCurrentPage, 0);
  }

  buildStyles();
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", scheduleMount, { once: true });
  } else {
    scheduleMount();
  }
  document.addEventListener("nav", scheduleMount);
  const observer = new MutationObserver(scheduleMount);
  observer.observe(document.body, { childList: true, subtree: true });
})();
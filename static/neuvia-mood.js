(() => {
  "use strict";
  if (window.__neuviaMoodLoaded) return;
  window.__neuviaMoodLoaded = true;

  const API = "https://neuvia-admin-api.forkleafcustom.workers.dev";
  const CATALOG_API = "https://neuvia-mood-catalog.forkleafcustom.workers.dev";
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

  async function loadNoteEntries() {
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
    return entries;
  }

  async function loadCatalogEntries() {
    const controller = typeof AbortController === "function" ? new AbortController() : null;
    const timeout = controller ? setTimeout(() => controller.abort(), 30000) : null;
    let response;
    try {
      response = await fetch(CATALOG_API + "/catalog", {
        cache: "no-store",
        ...(controller ? { signal: controller.signal } : {})
      });
    } finally {
      if (timeout) clearTimeout(timeout);
    }
    if (!response.ok) throw new Error("Der Czepeku-Katalog konnte nicht geladen werden.");
    const data = await response.json();
    if (!Array.isArray(data.items)) throw new Error("Czepeku hat keine Katalogdaten geliefert.");
    return data.items.map((item) => {
      const animated = /animated/i.test(String(item.defaultVariant || ""));
      return {
        path: "czepeku-parent:" + item.id,
        catalogId: String(item.id),
        catalogPath: String(item.catalogPath || ""),
        isCatalog: true,
        title: String(item.title || "Unbenannte Map / Scene"),
        moodType: String(item.moodType || "Map"),
        category: String(item.category || ""),
        mediaType: animated ? "video" : "image",
        source: "Czepeku · " + String(item.universe || ""),
        universe: String(item.universe || ""),
        media: String(item.previewUrl || ""),
        preview: String(item.previewUrl || ""),
        full: String(item.fullUrl || item.previewUrl || ""),
        sourceUrl: String(item.sourceUrl || ""),
        defaultVariant: String(item.defaultVariant || ""),
        animated,
        tags: Array.isArray(item.tags) ? item.tags.map(String) : [],
        variants: null
      };
    });
  }

  async function loadEntries() {
    return loadCatalogEntries();
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
      #neuvia-mood .nm-preview img { display:block; width:100%; height:100%; object-fit:cover; }
      #neuvia-mood .nm-variant-panel { border-top:1px solid var(--lightgray); padding:11px; }
      #neuvia-mood .nm-variant-heading { display:flex; align-items:center; justify-content:space-between; gap:8px; margin-bottom:9px; font-size:.88em; }
      #neuvia-mood .nm-variant-grid { display:grid; grid-template-columns:repeat(auto-fill,minmax(105px,1fr)); gap:8px; }
      #neuvia-mood .nm-variant { display:flex; flex-direction:column; gap:5px; min-width:0; padding:5px; text-align:left; }
      #neuvia-mood .nm-variant-image { position:relative; display:block; width:100%; aspect-ratio:4/3; overflow:hidden; border-radius:5px; background:#17191d; }
      #neuvia-mood .nm-variant-image img { width:100%; height:100%; object-fit:cover; display:block; }
      #neuvia-mood .nm-variant-name { overflow-wrap:anywhere; font-size:.82em; line-height:1.2; }
      #neuvia-mood .nm-variant-badge { position:absolute; left:4px; top:4px; border-radius:4px; padding:2px 5px; color:white; background:#000b; font-size:10px; }
      #neuvia-mood .nm-load-more-wrap { grid-column:1/-1; display:flex; justify-content:center; padding:8px; }
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
      #neuvia-mood-player .nm-player-buttons { display:flex; align-items:center; flex-wrap:wrap; gap:7px; flex-shrink:0; }
      #neuvia-mood-player .nm-zoom-level { min-width:42px; text-align:center; color:#ddd; font-size:.82em; font-variant-numeric:tabular-nums; }
      #neuvia-mood-player button, #neuvia-mood-player .nm-source-link { border:1px solid #ffffff55; border-radius:7px; color:white; background:#17191dcc; padding:8px 10px; cursor:pointer; text-decoration:none; font:inherit; }
      #neuvia-mood-player .nm-stage { touch-action:none; }
      @media (max-width:700px) {
        #neuvia-mood-player .nm-player-bar { align-items:flex-start; flex-direction:column; gap:7px; }
        #neuvia-mood-player .nm-player-buttons { width:100%; }
      }
      #neuvia-mood-player .nm-stage { flex:1; min-height:0; display:flex; align-items:center; justify-content:center; overflow:hidden; }
      #neuvia-mood-player .nm-stage img, #neuvia-mood-player .nm-stage video { display:block; width:100%; height:100%; object-fit:contain; }
      #neuvia-mood-player .nm-player-message { color:#ddd; padding:24px; text-align:center; }
      body.neuvia-mood-player-page { overflow:hidden !important; }
      @media (max-width:600px) {
        #neuvia-mood .nm-grid { grid-template-columns:repeat(2,minmax(0,1fr)); gap:9px; }
        #neuvia-mood .nm-card-body { padding:9px; }
        #neuvia-mood .nm-variant-grid { grid-template-columns:repeat(2,minmax(0,1fr)); }
      }
    `;
    document.head.appendChild(style);
  }

  function openPlayer(entry) {
    const url = new URL("/mood/player/", window.location.origin);
    if (entry.isCatalog || entry.isCatalogVariant) {
      if (entry.sourceUrl) url.searchParams.set("source", entry.sourceUrl);
      if (entry.preview) url.searchParams.set("preview", entry.preview);
      if (entry.full) url.searchParams.set("full", entry.full);
      if (entry.mediaUrl) url.searchParams.set("media", entry.mediaUrl);
      if (entry.animated) url.searchParams.set("animated", "1");
      url.searchParams.set("title", entry.title || "Czepeku");
    } else {
      url.searchParams.set("path", entry.path);
    }
    window.open(url.href, "_blank", "noopener");
  }

  function renderPreview(entry) {
    const animatedAsset = entry.mediaType === "video" || getExtension(entry.media || "") === "gif";
    const previewValue = entry.preview || (entry.isCatalog || entry.isCatalogVariant || animatedAsset ? "" : entry.media);
    const previewUrl = resolveMedia(previewValue);
    if (!previewUrl || isVideo(previewValue) || getExtension(previewValue) === "gif") {
      return '<div class="nm-preview"><span class="nm-preview-badge">' +
        (entry.animated || animatedAsset ? "Animation beim Öffnen" : "Keine Vorschau") + '</span></div>';
    }
    return '<div class="nm-preview"><img loading="lazy" src="' + esc(previewUrl) + '" alt="' + esc(entry.title) + '"><span class="nm-preview-badge">' +
      (entry.universe ? esc(entry.universe) + " · " : "") + (entry.moodType === "Scene" ? "Scene" : "Map") + '</span></div>';
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
      '<select class="nm-universe" aria-label="Universum filtern"><option value="">Fantasy und Sci-Fi</option><option value="Fantasy">Fantasy</option><option value="Sci-Fi">Sci-Fi</option></select>',
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
    const universeFilter = $(root, ".nm-universe");
    const variantLookup = new Map();
    const expandedVariants = new Set();
    let visibleLimit = 60;
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
      buttons.forEach((button) => { button.disabled = false; });
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

    function renderVariantPanel(entry) {
      if (!expandedVariants.has(entry.catalogId)) return "";
      if (!Array.isArray(entry.variants)) {
        return '<div class="nm-variant-panel"><p class="nm-card-meta">Varianten werden geladen …</p></div>';
      }
      if (!entry.variants.length) {
        return '<div class="nm-variant-panel"><p class="nm-card-meta">Für diesen Eintrag wurden keine Varianten gefunden.</p></div>';
      }
      const variants = entry.variants.map((variant) => {
        const variantEntry = {
          path: "czepeku-variant:" + entry.catalogId + "::" + variant.slug,
          isCatalogVariant: true,
          title: variant.title,
          moodType: entry.moodType,
          universe: entry.universe,
          preview: variant.previewUrl,
          full: variant.fullUrl || variant.previewUrl,
          media: variant.mediaUrl || variant.previewUrl,
          mediaUrl: variant.mediaUrl || "",
          sourceUrl: variant.sourceUrl,
          animated: Boolean(variant.animated),
          tags: entry.tags || [],
          source: entry.source
        };
        variantLookup.set(variantEntry.path, variantEntry);
        return '<button type="button" class="nm-variant" data-nm-variant-open="' + esc(variantEntry.path) + '" title="Öffnen: ' + esc(variant.title) + '">' +
          '<span class="nm-variant-image"><img loading="lazy" src="' + esc(variant.previewUrl) + '" alt="' + esc(variant.title) + '">' +
          (variantEntry.animated ? '<span class="nm-variant-badge">Animation</span>' : '') + '</span>' +
          '<span class="nm-variant-name">' + esc(variant.name) + '</span>' +
          '</button>';
      }).join("");
      return '<div class="nm-variant-panel"><div class="nm-variant-heading">' +
        '<strong>' + entry.variants.length + ' Varianten</strong>' +
        '<button type="button" data-nm-variants="' + esc(entry.catalogId) + '">Schließen</button>' +
        '</div><div class="nm-variant-grid">' + variants + '</div></div>';
    }

    async function fetchVariants(entry) {
      const response = await fetch(CATALOG_API + "/variants?path=" + encodeURIComponent(entry.catalogPath), { cache: "no-store" });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !Array.isArray(data.variants)) {
        throw new Error(data.error || "Die Varianten konnten nicht geladen werden.");
      }
      entry.variants = data.variants;
      entry.variantsCount = data.variants.length;
      if (Array.isArray(data.tags) && data.tags.length) {
        entry.tags = Array.from(new Set([...(entry.tags || []), ...data.tags]));
        entry.category = entry.category || data.tags[0] || "";
        refreshCategories();
      }
      return entry.variants;
    }

    function draw() {
      const query = search.value.trim().toLocaleLowerCase("de");
      const wantedType = typeFilter.value;
      const wantedUniverse = universeFilter.value;
      const wantedCategory = categoryFilter.value;
      const wantedMedia = mediaFilter.value;
      const visible = entries.filter((entry) => {
        const haystack = [entry.title, entry.category, entry.source, entry.universe, entry.defaultVariant, ...(entry.tags || [])]
          .join(" ").toLocaleLowerCase("de");
        return (!query || haystack.includes(query))
          && (!wantedType || entry.moodType === wantedType)
          && (!wantedUniverse || entry.universe === wantedUniverse)
          && (!wantedCategory || entry.category === wantedCategory)
          && (!wantedMedia || entry.mediaType === wantedMedia);
      });
      variantLookup.clear();
      if (!visible.length) {
        grid.innerHTML = '<div class="nm-empty">' + (entries.length
          ? "Keine passenden Maps oder Scenes gefunden."
          : "Noch keine Einträge vorhanden. Füge oben eine externe URL oder ein eigenes Bild hinzu.") + '</div>';
        status(root, entries.length ? "0 Treffer" : "Die Bibliothek ist bereit.");
        return;
      }
      const shown = visible.slice(0, visibleLimit);
      const cards = shown.map((entry) => {
        const tags = (entry.tags || []).slice(0, 5).map((tag) => '<span class="nm-tag">' + esc(tag) + '</span>').join("");
        const meta = [entry.moodType || "Map", entry.universe, entry.category, entry.source].filter(Boolean).join(" · ");
        const action = entry.isCatalog
          ? '<div class="nm-card-actions"><button type="button" data-nm-variants="' + esc(entry.catalogId) + '">' +
              (Array.isArray(entry.variants) ? (expandedVariants.has(entry.catalogId) ? "Varianten schließen" : "Varianten (" + entry.variants.length + ")") : "Varianten anzeigen") +
            '</button><button type="button" data-nm-open-button="' + esc(entry.path) + '">Öffnen ↗</button></div>'
          : '<div class="nm-card-actions"><button type="button" data-nm-open-button="' + esc(entry.path) + '">Öffnen ↗</button></div>';
        return '<article class="nm-card" tabindex="0" role="button" data-nm-open="' + esc(entry.path) + '" title="Doppelklick zum Öffnen">' +
          renderPreview(entry) +
          '<div class="nm-card-body">' +
          '<p class="nm-card-title">' + esc(entry.title) + '</p>' +
          '<p class="nm-card-meta">' + esc(meta) + '</p>' +
          (tags ? '<div class="nm-tags">' + tags + '</div>' : '') +
          action +
          '</div>' +
          (entry.isCatalog ? renderVariantPanel(entry) : '') +
          '</article>';
      }).join("");
      grid.innerHTML = cards + (visible.length > visibleLimit
        ? '<div class="nm-load-more-wrap"><button type="button" data-nm-load-more>Mehr laden (' + (visible.length - visibleLimit) + ' verbleibend)</button></div>'
        : '');
      status(root, shown.length + " von " + visible.length + " Treffern · " + entries.length + " insgesamt");
    }

    function showForm(mode) {
      if (!token()) {
        status(root, "Bitte zuerst oben rechts über „Bearbeiten“ anmelden.", true);
        return;
      }
      authNote.textContent = "Administrator angemeldet – du kannst Medien hinzufügen.";
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
      const loadMore = event.target.closest("[data-nm-load-more]");
      if (loadMore) {
        visibleLimit += 60;
        draw();
        return;
      }
      const variantToggle = event.target.closest("[data-nm-variants]");
      if (variantToggle) {
        const entry = entries.find((item) => item.isCatalog && item.catalogId === variantToggle.dataset.nmVariants);
        if (!entry) return;
        if (expandedVariants.has(entry.catalogId)) {
          expandedVariants.delete(entry.catalogId);
          draw();
          return;
        }
        expandedVariants.add(entry.catalogId);
        if (!Array.isArray(entry.variants)) {
          variantToggle.disabled = true;
          variantToggle.textContent = "Lade Varianten …";
          fetchVariants(entry).then(() => draw()).catch((error) => {
            expandedVariants.delete(entry.catalogId);
            status(root, error.message || "Varianten konnten nicht geladen werden.", true);
            draw();
          });
        } else {
          draw();
        }
        return;
      }
      const variantButton = event.target.closest("[data-nm-variant-open]");
      if (variantButton) {
        const variant = variantLookup.get(variantButton.dataset.nmVariantOpen);
        if (variant) openPlayer(variant);
        return;
      }
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
    [search, typeFilter, universeFilter, categoryFilter, mediaFilter].forEach((control) => {
      control.addEventListener("input", () => { visibleLimit = 60; draw(); });
      control.addEventListener("change", () => { visibleLimit = 60; draw(); });
    });

    refreshAuth();
    loadEntries().then((loaded) => {
      entries = loaded;
      refreshCategories();
      draw();

      // Personal uploads and manually added entries are loaded after the Czepeku catalogue.
      // A slow or unavailable legacy index must never hold the main gallery open.
      loadNoteEntries().then((notes) => {
        const known = new Set(entries.map((entry) => entry.path));
        const additional = notes.filter((entry) => !known.has(entry.path));
        if (!additional.length) return;
        entries = [...entries, ...additional].sort((a, b) =>
          a.title.localeCompare(b.title, "de", { sensitivity: "base" }));
        refreshCategories();
        draw();
      }).catch(() => {});
    }).catch((error) => {
      grid.innerHTML = '<div class="nm-empty">Der Czepeku-Katalog konnte nicht geladen werden. Eigene Einträge werden separat geladen.</div>';
      status(root, error.message, true);
      loadNoteEntries().then((notes) => {
        entries = notes;
        refreshCategories();
        draw();
        status(root, "Czepeku konnte nicht geladen werden; " + entries.length + " eigene Einträge verfügbar.", true);
      }).catch(() => {});
    });
  }

  async function mountPlayer(root) {
    buildStyles();
    document.body.classList.add("neuvia-mood-player-page");
    root.innerHTML = [
      '<div class="nm-player">',
      '<div class="nm-player-bar"><div class="nm-player-title">Mood</div>',
      '<div class="nm-player-buttons">',
      '<button type="button" data-nm-zoom-out aria-label="Verkleinern">−</button>',
      '<span class="nm-zoom-level" aria-live="polite">100%</span>',
      '<button type="button" data-nm-zoom-in aria-label="Vergrößern">+</button>',
      '<button type="button" data-nm-zoom-fit>Anpassen</button>',
      '<button type="button" data-nm-fullscreen>Vollbild</button>',
      '<button type="button" data-nm-close>Zur Mood-Bibliothek</button>',
      '</div></div>',
      '<div class="nm-stage"><div class="nm-player-message">Lade Medium …</div></div>',
      '</div>'
    ].join("");

    const title = $(root, ".nm-player-title");
    const stage = $(root, ".nm-stage");
    const zoomLabel = $(root, ".nm-zoom-level");
    const params = new URLSearchParams(window.location.search);
    const path = params.get("path") || "";
    const sourceUrl = params.get("source") || "";
    const previewParam = params.get("preview") || "";
    const fullParam = params.get("full") || "";
    const mediaParam = params.get("media") || "";
    const animatedParam = params.get("animated") === "1";

    let zoomImage = null;
    let zoomLevel = 1;
    let offsetX = 0;
    let offsetY = 0;
    let dragging = false;
    let dragPointer = null;
    let lastPointerX = 0;
    let lastPointerY = 0;

    const applyZoom = () => {
      if (!zoomImage) return;
      zoomImage.style.transform = "translate3d(" + offsetX + "px," + offsetY + "px,0) scale(" + zoomLevel + ")";
      zoomImage.style.cursor = zoomLevel > 1 ? (dragging ? "grabbing" : "grab") : "zoom-in";
      zoomLabel.textContent = Math.round(zoomLevel * 100) + "%";
    };

    const setZoom = (next, clientX, clientY) => {
      if (!zoomImage) return;
      const nextZoom = Math.max(1, Math.min(8, next));
      if (clientX != null && clientY != null && nextZoom !== zoomLevel) {
        const rect = stage.getBoundingClientRect();
        const px = clientX - rect.left - rect.width / 2;
        const py = clientY - rect.top - rect.height / 2;
        offsetX = px - ((px - offsetX) / zoomLevel) * nextZoom;
        offsetY = py - ((py - offsetY) / zoomLevel) * nextZoom;
      }
      zoomLevel = nextZoom;
      if (zoomLevel === 1) {
        offsetX = 0;
        offsetY = 0;
      }
      applyZoom();
    };

    const showImage = (image, fallbackUrl, errorMessage) => {
      zoomImage = image;
      zoomLevel = 1;
      offsetX = 0;
      offsetY = 0;
      dragging = false;
      image.style.cssText = "display:block;width:100%;height:100%;object-fit:contain;max-width:none;max-height:none;user-select:none;touch-action:none;will-change:transform;transform-origin:center center;";
      image.draggable = false;
      image.addEventListener("error", () => {
        if (fallbackUrl && image.src !== fallbackUrl && !image.dataset.fallbackTried) {
          image.dataset.fallbackTried = "yes";
          image.src = fallbackUrl;
          return;
        }
        zoomImage = null;
        zoomLabel.textContent = "—";
        stage.innerHTML = '<div class="nm-player-message">' + esc(errorMessage) + '</div>';
      });
      stage.replaceChildren(image);
      applyZoom();
    };

    stage.addEventListener("wheel", (event) => {
      if (!zoomImage) return;
      event.preventDefault();
      const factor = Math.pow(1.0018, -event.deltaY);
      setZoom(zoomLevel * factor, event.clientX, event.clientY);
    }, { passive: false });

    stage.addEventListener("pointerdown", (event) => {
      if (!zoomImage || zoomLevel <= 1) return;
      dragging = true;
      dragPointer = event.pointerId;
      lastPointerX = event.clientX;
      lastPointerY = event.clientY;
      stage.setPointerCapture(event.pointerId);
      applyZoom();
    });

    stage.addEventListener("pointermove", (event) => {
      if (!dragging || event.pointerId !== dragPointer) return;
      offsetX += event.clientX - lastPointerX;
      offsetY += event.clientY - lastPointerY;
      lastPointerX = event.clientX;
      lastPointerY = event.clientY;
      applyZoom();
    });

    const stopDragging = (event) => {
      if (!dragging || (event && event.pointerId !== dragPointer)) return;
      dragging = false;
      dragPointer = null;
      applyZoom();
    };
    stage.addEventListener("pointerup", stopDragging);
    stage.addEventListener("pointercancel", stopDragging);
    stage.addEventListener("lostpointercapture", stopDragging);

    stage.addEventListener("dblclick", (event) => {
      if (!zoomImage) return;
      event.preventDefault();
      setZoom(zoomLevel > 1 ? 1 : 2.5, event.clientX, event.clientY);
    });

    root.querySelector("[data-nm-zoom-in]").addEventListener("click", () => setZoom(zoomLevel * 1.4));
    root.querySelector("[data-nm-zoom-out]").addEventListener("click", () => setZoom(zoomLevel / 1.4));
    root.querySelector("[data-nm-zoom-fit]").addEventListener("click", () => {
      zoomLevel = 1;
      offsetX = 0;
      offsetY = 0;
      applyZoom();
    });

    root.querySelector("[data-nm-fullscreen]").addEventListener("click", async () => {
      try {
        if (!document.fullscreenElement) await root.requestFullscreen();
        else await document.exitFullscreen();
      } catch {
        title.textContent = title.textContent + " (Vollbild nicht verfügbar)";
      }
    });
    root.querySelector("[data-nm-close]").addEventListener("click", () => {
      window.location.href = "/mood/";
    });

    if (sourceUrl) {
      let parsedSource;
      try { parsedSource = new URL(sourceUrl); } catch {}
      if (!parsedSource || parsedSource.protocol !== "https:" || parsedSource.hostname !== "www.czepeku.com") {
        stage.innerHTML = '<div class="nm-player-message">Ungültiger Czepeku-Link.</div>';
        return;
      }
      title.textContent = params.get("title") || "Czepeku";
      stage.replaceChildren();

      if (mediaParam && isVideo(mediaParam)) {
        const video = document.createElement("video");
        video.src = mediaParam;
        video.autoplay = true;
        video.loop = true;
        video.muted = true;
        video.playsInline = true;
        video.controls = true;
        video.preload = "auto";
        video.addEventListener("error", () => {
          stage.innerHTML = '<div class="nm-player-message">Die Animation konnte nicht geladen werden. Öffne die Originalseite.</div>';
        });
        stage.appendChild(video);
        video.play().catch(() => {});
      } else if (animatedParam) {
        const iframe = document.createElement("iframe");
        iframe.src = sourceUrl;
        iframe.title = title.textContent;
        iframe.allow = "autoplay; fullscreen; picture-in-picture";
        iframe.allowFullscreen = true;
        iframe.referrerPolicy = "strict-origin-when-cross-origin";
        iframe.style.cssText = "border:0;width:100%;height:100%;background:#07080b";
        stage.appendChild(iframe);
        zoomLabel.textContent = "—";
      } else {
        const image = document.createElement("img");
        image.src = fullParam || previewParam;
        image.alt = title.textContent;
        showImage(image, previewParam && previewParam !== fullParam ? previewParam : "", "Das Bild konnte nicht geladen werden. Öffne die Originalseite.");
      }

      const openSource = document.createElement("a");
      openSource.href = sourceUrl;
      openSource.target = "_blank";
      openSource.rel = "noopener noreferrer";
      openSource.textContent = "Original bei Czepeku öffnen";
      openSource.className = "nm-source-link";
      root.querySelector(".nm-player-buttons").prepend(openSource);
      return;
    }

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
        zoomLabel.textContent = "—";
      } else {
        const image = document.createElement("img");
        image.src = mediaUrl;
        image.alt = title.textContent;
        showImage(image, resolveMedia(meta.preview || ""), "Das Bild konnte nicht geladen werden. Prüfe die URL oder den Zugriff auf die Quelldatei.");
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
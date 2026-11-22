// Neuvia live reader: load the current Markdown source while keeping the Quartz layout.
// Phase 1 release sync: deploy this bundle with the matching Worker routes.
// Preserve authored map embeds when refreshing Markdown from the live source.
// Bundle source is copied into the Quartz workspace before esbuild resolves npm packages.
// Preview release uses the v3 workflow concurrency lane.
import { marked } from "marked";
import createDOMPurify from "dompurify";

(() => {
  if (window.__neuviaLiveReader) return;
  window.__neuviaLiveReader = true;

  const API = "https://neuvia-admin-api.forkleafcustom.workers.dev";
  const basePath = (document.body?.dataset?.basepath || "").replace(/\/$/, "");
  const staticBase = basePath + "/static/";
  const purifier = createDOMPurify;
  let indexesPromise;
  let currentPath = "";
  let runId = 0;

  const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  })[c]);

  const normalize = (value) => {
    let text = String(value || "").trim();
    try { text = decodeURIComponent(text); } catch {}
    return text.replace(/^\.\//, "").replace(/^\//, "").replace(/\.md$/i, "").toLocaleLowerCase("de");
  };

  const slugify = (value) => String(value || "").normalize("NFC").toLocaleLowerCase("de")
    .replace(/&/g, "-and-").replace(/%/g, "-percent").replace(/[?#]/g, "")
    .replace(/[<>:"|*]/g, "").trim().replace(/\s+/g, "-");

  const apiUrl = (route, path) => API + route + "?path=" + encodeURIComponent(path);

  async function indexes() {
    if (!indexesPromise) {
      indexesPromise = Promise.all([
        fetch(staticBase + "neuvia-content-map.json", { cache: "no-store" }),
        fetch(staticBase + "neuvia-link-index.json", { cache: "no-store" }),
        fetch(staticBase + "neuvia-asset-index.json", { cache: "no-store" })
      ]).then(async ([mapResponse, linkResponse, assetResponse]) => {
        if (!mapResponse.ok || !linkResponse.ok || !assetResponse.ok) throw new Error("Linkindex nicht verfügbar");
        return { map: await mapResponse.json(), links: await linkResponse.json(), assets: await assetResponse.json() };
      }).catch((error) => { indexesPromise = null; throw error; });
    }
    return indexesPromise;
  }

  function canonicalRoute(path) {
    let stem = String(path || "").replace(/\.md$/i, "");
    if (stem.toLowerCase() === "index") return "";
    if (stem.toLowerCase().endsWith("/index")) stem = stem.slice(0, -6);
    return slugify(stem);
  }

  function contextScore(itemPath, sourcePath) {
    if (!sourcePath) return -1;
    const sourceFolders = sourcePath.split("/").slice(0, -1).map(normalize);
    const targetFolders = itemPath.split("/").slice(0, -1).map(normalize);
    let common = 0;
    while (common < sourceFolders.length && common < targetFolders.length
      && sourceFolders[common] === targetFolders[common]) common++;
    const sameRoot = sourceFolders[0] && sourceFolders[0] === targetFolders[0];
    return common * 100 + (sameRoot ? 20 : 0) - Math.abs(sourceFolders.length - targetFolders.length);
  }

  function chooseContextual(matches, sourcePath) {
    const unique = Array.from(new Map(matches.map((item) => [item.path, item])).values());
    if (unique.length === 1) return unique[0];
    if (!unique.length || !sourcePath) return null;
    const ranked = unique.map((item) => ({
      item,
      score: contextScore(item.path, sourcePath),
    })).sort((a, b) => b.score - a.score || a.item.path.localeCompare(b.item.path, "de"));
    if (ranked.length > 1 && ranked[0].score === ranked[1].score) return null;
    return ranked[0].score >= 0 ? ranked[0].item : null;
  }

  function resolvePath(slug, data) {
    const wanted = normalize(slug);
    const candidates = [slug, wanted, slugify(slug)];
    for (const key of candidates) if (data.map[key]) return data.map[key];
    const matches = data.links.filter((item) =>
      normalize(item.route || canonicalRoute(item.path)) === wanted
      || normalize(item.target) === wanted
    );
    return chooseContextual(matches, "")?.path || "";
  }

  function resolveLink(target, data, sourcePath = currentPath) {
    const wanted = normalize(String(target || "").split("#")[0]);
    if (!wanted) return null;
    const matches = data.links.filter((item) =>
      [item.target, item.path, item.title, ...(item.aliases || [])]
        .some((value) => normalize(value) === wanted)
    );
    const exact = chooseContextual(matches, sourcePath);
    if (exact) return exact;
    if (matches.length === 1) return matches[0];

    const tail = wanted.split("/").pop();
    const byName = data.links.filter((item) =>
      [item.title, item.path.split("/").pop().replace(/\.md$/i, "")]
        .some((value) => normalize(value) === tail)
    );
    return chooseContextual(byName, sourcePath);
  }

  function normalizeVaultPath(value) {
    const parts = [];
    for (const raw of String(value || "").split("/")) {
      if (!raw || raw === ".") continue;
      if (raw === "..") { parts.pop(); continue; }
      parts.push(raw);
    }
    return parts.join("/");
  }

  function resolveMarkdownPage(href, sourcePath, data) {
    const raw = String(href || "").trim();
    if (!raw || /^(https?:|mailto:|tel:|data:|blob:|javascript:|\/\/)/i.test(raw)) return null;

    const hashAt = raw.indexOf("#");
    const anchorRaw = hashAt >= 0 ? raw.slice(hashAt + 1) : "";
    const beforeHash = hashAt >= 0 ? raw.slice(0, hashAt) : raw;
    const queryAt = beforeHash.indexOf("?");
    const pathRaw = queryAt >= 0 ? beforeHash.slice(0, queryAt) : beforeHash;
    let anchor = anchorRaw;
    try { anchor = decodeURIComponent(anchorRaw); } catch {}
    if (!pathRaw) {
      const self = data.links.find((item) => item.path === sourcePath);
      return self ? { item: self, anchor } : null;
    }

    let decoded = pathRaw;
    try { decoded = decodeURIComponent(pathRaw); } catch {}
    const absolute = decoded.startsWith("/");
    decoded = decoded.replace(/^\/+/, "");
    const sourceParts = sourcePath.split("/");
    sourceParts.pop();
    const sourceFolder = sourceParts.join("/");
    const candidates = [];
    const addCandidate = (value) => {
      const clean = normalizeVaultPath(value);
      if (!clean) return;
      const values = [];
      if (/\.html?$/i.test(clean)) values.push(clean.replace(/\.html?$/i, ".md"));
      else if (/\.md$/i.test(clean)) values.push(clean);
      else {
        values.push(clean + ".md");
        values.push(clean.replace(/\/+$/, "") + "/index.md");
      }
      for (const path of values) if (!candidates.includes(path)) candidates.push(path);
    };

    // The SRD uses links relative to the root of its imported vault, not to
    // the individual spell/class file. Honour that convention before normal
    // source-relative Markdown resolution.
    const srdRoot = "Regelbuch/dnd5e-markdown-main";
    if (!absolute && sourcePath.startsWith(srdRoot + "/")
      && /^(compendium|rules|templates|tools)\//i.test(decoded)) {
      addCandidate(srdRoot + "/" + decoded);
    }
    if (!absolute && sourceFolder) addCandidate(sourceFolder + "/" + decoded);
    addCandidate(decoded);

    for (const candidate of candidates) {
      const matches = data.links.filter((item) => normalize(item.path) === normalize(candidate));
      const item = chooseContextual(matches, sourcePath);
      if (item) return { item, anchor };
      if (matches.length === 1) return { item: matches[0], anchor };
    }

    const fallback = resolveLink(decoded.replace(/\.md$/i, "").replace(/\/+$/, ""), data, sourcePath);
    return fallback ? { item: fallback, anchor } : null;
  }

  function routeFor(item, data, anchor) {
    const slug = String(item.route || canonicalRoute(item.path));
    const route = slug ? "/" + slug.split("/").map(encodeURIComponent).join("/") : "/";
    return basePath.replace(/\/$/, "") + route
      + (anchor ? "#" + encodeURIComponent(slugify(anchor)) : "");
  }

  function assetPath(value) {
    let path = String(value || "").trim();
    try { path = decodeURIComponent(path); } catch {}
    if (/^(https?:|data:|blob:)/i.test(path)) return path;
    const absolute = path.startsWith("/");
    const parts = absolute || /^(files|assets)\//i.test(path)
      ? []
      : currentPath.includes("/") ? currentPath.split("/").slice(0, -1) : [];
    for (const segment of path.replace(/^\/+/, "").split("/")) {
      if (!segment || segment === ".") continue;
      if (segment === "..") {
        if (parts.length) parts.pop();
        continue;
      }
      parts.push(segment);
    }
    return parts.join("/");
  }

  function resolveAssetPath(value) {
    const candidate = assetPath(value);
    const assets = window.__neuviaIndexes?.assets;
    if (!assets) return candidate;
    const known = new Set(assets.files || []);
    if (known.has(candidate)) return candidate;
    const filename = candidate.split("/").pop().toLocaleLowerCase("de");
    const matches = assets.byName?.[filename] || [];
    return matches.length === 1 ? matches[0] : candidate;
  }

  const markdownRenderer = new marked.Renderer();
  const defaultLinkRenderer = markdownRenderer.link.bind(markdownRenderer);
  markdownRenderer.link = (token) => {
    const data = window.__neuviaIndexes;
    const resolved = data ? resolveMarkdownPage(token.href, currentPath, data) : null;
    if (!resolved) return defaultLinkRenderer(token);
    const href = routeFor(resolved.item, data, resolved.anchor);
    return defaultLinkRenderer({ ...token, href }).replace("<a ", '<a class="internal" ');
  };

  const defaultImageRenderer = markdownRenderer.image.bind(markdownRenderer);
  markdownRenderer.image = (token) => {
    const href = String(token.href || "");
    if (!href || /^(https?:|data:|blob:|\/|#)/i.test(href)) return defaultImageRenderer(token);
    const src = apiUrl("/api/public-asset", resolveAssetPath(href));
    const title = token.title ? ' title="' + esc(token.title) + '"' : "";
    return '<img loading="lazy" class="neuvia-live-image" src="' + esc(src) + '" alt="' + esc(token.text || "") + '"' + title + '>';
  };

  const wikiExtension = {
    name: "neuviaWikiLink",
    level: "inline",
    start(source) { const i = source.indexOf("[["); return i < 0 ? undefined : i; },
    tokenizer(source) {
      const match = /^(!?)\[\[([^\]\n]+)\]\]/.exec(source);
      if (!match) return undefined;
      const parts = match[2].split("|");
      return { type: "neuviaWikiLink", raw: match[0], embed: match[1] === "!", target: parts.shift().trim(), alias: parts.join("|").trim() };
    },
    renderer(token) {
      const data = window.__neuviaIndexes;
      if (!data) return esc(token.alias || token.target);
      const [target, ...anchorParts] = token.target.split("#");
      const anchor = anchorParts.join("#");
      if (token.embed && /\.(png|jpe?g|webp|gif|avif|pdf)$/i.test(target)) {
        const resolvedAsset = resolveAssetPath(target);
        const url = /^(https?:|data:|blob:)/i.test(resolvedAsset)
          ? resolvedAsset
          : apiUrl("/api/public-asset", resolvedAsset);
        if (/\.pdf$/i.test(target)) return '<a href="' + esc(url) + '" target="_blank" rel="noopener">' + esc(token.alias || target.split("/").pop()) + "</a>";
        return '<img loading="lazy" class="neuvia-live-image" src="' + esc(url) + '" alt="' + esc(token.alias || target.split("/").pop()) + '">';
      }
      const item = resolveLink(target, data, currentPath);
      if (!item) return esc(token.alias || target);
      if (token.embed) return '<div class="neuvia-live-transclude" data-path="' + esc(item.path) + '"></div>';
      return '<a class="internal" href="' + esc(routeFor(item, data, anchor)) + '">' + esc(token.alias || item.title || target) + "</a>";
    }
  };

  const highlightExtension = {
    name: "neuviaHighlight",
    level: "inline",
    start(source) { const i = source.indexOf("=="); return i < 0 ? undefined : i; },
    tokenizer(source) {
      const match = /^==([^=\n][\s\S]*?)==/.exec(source);
      return match ? { type: "neuviaHighlight", raw: match[0], text: match[1] } : undefined;
    },
    renderer(token) { return "<mark>" + esc(token.text) + "</mark>"; }
  };

  marked.use({ gfm: true, renderer: markdownRenderer, extensions: [wikiExtension, highlightExtension] });

  function stripFrontmatter(source) {
    const text = String(source || "").replace(/^\uFEFF/, "");
    const match = /^---[ \t]*\r?\n[\s\S]*?\r?\n(?:---|\.\.\.)[ \t]*(?:\r?\n|$)/.exec(text);
    return match ? text.slice(match[0].length) : text;
  }

  function decorate(container) {
    container.querySelectorAll("blockquote > p:first-child").forEach((paragraph) => {
      const match = /^\[(NOTE|INFO|TIP|SUCCESS|WARNING|DANGER|BUG|QUESTION|QUOTE|ABSTRACT|TODO|EXAMPLE|FAILURE|IMPORTANT)\](.*)$/i.exec(paragraph.textContent.trim());
      if (!match) return;
      paragraph.parentElement.classList.add("callout", "callout-" + match[1].toLowerCase());
      paragraph.classList.add("callout-title");
      paragraph.textContent = match[2].trim() || match[1].toLowerCase();
    });
    container.querySelectorAll("pre code.language-mermaid").forEach((code) => code.classList.add("mermaid"));
    const seen = new Set();
    container.querySelectorAll("h1,h2,h3,h4,h5,h6").forEach((heading) => {
      const base = slugify(heading.textContent);
      if (!base) return;
      let id = base, n = 1;
      while (seen.has(id) || document.getElementById(id)) id = base + "-" + n++;
      seen.add(id);
      heading.id = id;
    });
  }

  async function fetchNote(path) {
    const response = await fetch(apiUrl("/api/public-note", path), { cache: "no-store" });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || typeof data.content !== "string") throw new Error(data.error || "Notiz nicht verfügbar");
    return data.content;
  }

  async function render(container, source, path, stack, depth) {
    if (depth > 4) { container.textContent = "Weitere Einbettungen wurden begrenzt."; return; }
    currentPath = path;
    let markdown = stripFrontmatter(source);
    markdown = markdown.replace(/^(\s*>\s*)\[!(\w+)\]([^\r\n]*)/gm, (all, prefix, type, rest) => prefix + "[" + type.toUpperCase() + "]" + rest);
    const html = marked.parse(markdown, { gfm: true, breaks: true });
    container.innerHTML = purifier.sanitize(String(html), {
      ADD_TAGS: ["iframe"],
      ADD_ATTR: ["loading", "target", "rel", "width", "height", "style", "allow", "allowfullscreen", "referrerpolicy"]
    });
    decorate(container);
    for (const placeholder of Array.from(container.querySelectorAll(".neuvia-live-transclude"))) {
      const nestedPath = placeholder.dataset.path || "";
      if (!nestedPath || stack.includes(nestedPath)) { placeholder.textContent = "Zyklische Einbettung ausgelassen."; continue; }
      try {
        const nested = await fetchNote(nestedPath);
        const child = document.createElement("div");
        child.className = "neuvia-live-transclude-content";
        placeholder.replaceChildren(child);
        await render(child, nested, nestedPath, [...stack, nestedPath], depth + 1);
      } catch { placeholder.textContent = "Eingebettete Notiz nicht verfügbar."; }
    }
    // Quartz's Obsidian plugin listens for this event to render Mermaid diagrams.
    document.dispatchEvent(new Event("render"));
  }

  async function refresh() {
    const id = ++runId;
    const slug = document.body?.dataset?.slug || "";
    const article = document.querySelector("article.popover-hint .markdown-preview-view") || document.querySelector("article .markdown-preview-view");
    if (!slug || !article) return;
    try {
      const data = await indexes();
      if (id !== runId || document.body.dataset.slug !== slug) return;
      window.__neuviaIndexes = data;
      const path = resolvePath(slug, data);
      if (!path) return;
      const markdown = await fetchNote(path);
      if (id !== runId || document.body.dataset.slug !== slug) return;
      await render(article, markdown, path, [path], 0);
      article.dataset.neuviaLive = "true";
    } catch (error) {
      console.warn("[Neuvia] Live-Laden fehlgeschlagen; Quartz-Inhalt bleibt sichtbar.", error);
    }
  }

  const style = document.createElement("style");
  style.textContent = ".neuvia-live-image{max-width:100%;height:auto;border-radius:6px}.neuvia-live-transclude{margin:1rem 0;padding-left:1rem;border-left:3px solid var(--secondary)}article .callout{padding:.75rem 1rem;border-left:4px solid var(--secondary);background:var(--highlight);border-radius:4px}article .callout-title{font-weight:700;margin-top:0}";
  document.head.appendChild(style);

  const start = () => refresh();
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start, { once: true });
  else start();
  document.addEventListener("nav", () => setTimeout(refresh, 0));
})();

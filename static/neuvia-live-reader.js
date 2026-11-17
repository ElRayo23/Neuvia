// Neuvia live reader: load the current Markdown source while keeping the Quartz layout.
// Phase 1 release sync: deploy this bundle with the matching Worker routes.
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
        fetch(staticBase + "neuvia-link-index.json", { cache: "no-store" })
      ]).then(async ([mapResponse, linkResponse]) => {
        if (!mapResponse.ok || !linkResponse.ok) throw new Error("Linkindex nicht verfügbar");
        return { map: await mapResponse.json(), links: await linkResponse.json() };
      }).catch((error) => { indexesPromise = null; throw error; });
    }
    return indexesPromise;
  }

  function resolvePath(slug, data) {
    const candidates = [slug, normalize(slug), slugify(slug)];
    for (const key of candidates) if (data.map[key]) return data.map[key];
    const matches = data.links.filter((item) => normalize(item.target) === normalize(slug));
    return matches.length === 1 ? matches[0].path : "";
  }

  function resolveLink(target, data) {
    const wanted = normalize(target.split("#")[0]);
    const matches = data.links.filter((item) =>
      [item.target, item.path, item.title, ...(item.aliases || [])].some((value) => normalize(value) === wanted)
    );
    if (matches.length === 1) return matches[0];
    const tail = wanted.split("/").pop();
    const byName = data.links.filter((item) =>
      [item.title, item.path.split("/").pop().replace(/\.md$/i, "")].some((value) => normalize(value) === tail)
    );
    return byName.length === 1 ? byName[0] : null;
  }

  function routeFor(item, data, anchor) {
    const key = Object.keys(data.map).find((slug) => slug && data.map[slug] === item.path);
    const slug = key || slugify(item.path.replace(/\.md$/i, "").replace(/\/index$/i, ""));
    return basePath + "/" + slug.split("/").map(encodeURIComponent).join("/")
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

  const markdownRenderer = new marked.Renderer();
  const defaultImageRenderer = markdownRenderer.image.bind(markdownRenderer);
  markdownRenderer.image = (token) => {
    const href = String(token.href || "");
    if (!href || /^(https?:|data:|blob:|\/|#)/i.test(href)) return defaultImageRenderer(token);
    const src = apiUrl("/api/public-asset", assetPath(href));
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
        const resolvedAsset = assetPath(target);
        const url = /^(https?:|data:|blob:)/i.test(resolvedAsset)
          ? resolvedAsset
          : apiUrl("/api/public-asset", resolvedAsset);
        if (/\.pdf$/i.test(target)) return '<a href="' + esc(url) + '" target="_blank" rel="noopener">' + esc(token.alias || target.split("/").pop()) + "</a>";
        return '<img loading="lazy" class="neuvia-live-image" src="' + esc(url) + '" alt="' + esc(token.alias || target.split("/").pop()) + '">';
      }
      const item = resolveLink(target, data);
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
    const html = marked.parse(markdown, { gfm: true, breaks: false });
    container.innerHTML = purifier.sanitize(String(html), { ADD_ATTR: ["loading", "target", "rel"] });
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

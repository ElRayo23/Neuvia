const SITE = "https://www.czepeku.com";
const SOURCES = [
  { universe: "Fantasy", section: "maps", path: "/fantasy/maps/" },
  { universe: "Fantasy", section: "scenes", path: "/fantasy/scenes/" },
  { universe: "Sci-Fi", section: "maps", path: "/scifi/maps/" },
  { universe: "Sci-Fi", section: "scenes", path: "/scifi/scenes/" }
];
const CACHE_SECONDS = 1800;

function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "public, max-age=300, stale-while-revalidate=3600",
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "GET,OPTIONS",
    "access-control-allow-headers": "Content-Type"
  }});
}
function decodeHtml(value) {
  return String(value || "").replace(/&amp;/g, "&").replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&nbsp;/g, " ");
}
function attr(source, name) {
  const match = new RegExp("\\b" + name + "\\s*=\\s*(['\"])([\\s\\S]*?)\\1", "i").exec(source || "");
  return match ? decodeHtml(match[2]) : "";
}
function stripHtml(value) {
  return decodeHtml(String(value || "").replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " "))
    .replace(/\s+/g, " ").trim();
}
function collapseDuplicateText(value) {
  const words = String(value || "").split(/\s+/).filter(Boolean);
  for (let size = 1; size <= Math.floor(words.length / 2); size++) {
    if (words.length % size !== 0) continue;
    const part = words.slice(0, size).join(" ");
    if (words.every((_, index) => words[index] === words[index % size])) return part;
  }
  return words.join(" ");
}
function slugify(value) {
  return String(value || "").normalize("NFKD").replace(/[\u0300-\u036f]/g, "")
    .replace(/ß/g, "ss").toLowerCase().replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}
function imageUrlsFromTag(tag) {
  const srcset = attr(tag, "srcset");
  if (srcset) {
    // Keep the same URL extraction and preview ranking that produced the full catalogue.
    const urls = [...srcset.matchAll(/https?:\/\/\S+?\.(?:webp|png|jpe?g|avif|gif)(?=\s|$)/gi)]
      .map(item => item[0]);
    if (urls.length) {
      const previewUrls = [...urls].sort((a, b) => {
        const aw = Number((a.match(/width=(\d+)/i) || [])[1]) || 99999;
        const bw = Number((b.match(/width=(\d+)/i) || [])[1]) || 99999;
        return (aw <= 828 ? 0 : 1) - (bw <= 828 ? 0 : 1) || bw - aw;
      });
      const fullUrls = [...urls].sort((a, b) => {
        const aw = Number((a.match(/width=(\d+)/i) || [])[1]) || 0;
        const bw = Number((b.match(/width=(\d+)/i) || [])[1]) || 0;
        return aw - bw;
      });
      return {
        previewUrl: previewUrls[0],
        fullUrl: fullUrls[fullUrls.length - 1] || previewUrls[0]
      };
    }
  }
  const src = attr(tag, "src");
  const fallback = /^https?:\/\//i.test(src) ? src : "";
  return { previewUrl: fallback, fullUrl: fallback };
}
async function fetchHtml(path) {
  const absolute = new URL(path, SITE).href;
  const cache = caches.default;
  const key = new Request(absolute, { method: "GET" });
  const cached = await cache.match(key);
  if (cached) return { status: cached.status, url: absolute, html: await cached.text(), cached: true };
  const response = await fetch(absolute, { redirect: "follow", headers: {
    "user-agent": "Mozilla/5.0 (compatible; NeuviaMoodCatalog/1.0)",
    "accept": "text/html,application/xhtml+xml"
  }});
  const html = await response.text();
  if (response.ok && html.length > 1000) {
    await cache.put(key, new Response(html, {
      status: 200,
      headers: { "content-type": "text/html; charset=utf-8", "cache-control": "public, max-age=" + CACHE_SECONDS }
    }));
  }
  return { status: response.status, url: response.url || absolute, html, cached: false };
}
function parseDirectory(html, source) {
  const items = new Map();
  for (const match of html.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)) {
    const href = attr(match[1], "href");
    if (!href) continue;
    let parsed;
    try { parsed = new URL(href, SITE); } catch { continue; }
    if (parsed.hostname !== "www.czepeku.com") continue;
    const parts = parsed.pathname.split("/").filter(Boolean);
    if (parts.length !== 3 || parts[0] !== (source.universe === "Sci-Fi" ? "scifi" : "fantasy") || parts[1] !== source.section) continue;
    if (["themes", "series", "vistas", "search", "our-collection"].includes(parts[2])) continue;
    const inner = match[2];
    const imageTags = [...inner.matchAll(/<img\b[^>]*>/gi)].map(item => item[0]);
    const imageTag = imageTags.find(tag => /variant/i.test(attr(tag, "alt"))) || imageTags[0] || "";
    const alt = attr(imageTag, "alt");
    const altMatch = alt.match(/^(.+?)\s+(?:map|scene),\s*(.+?)\s+variant(?:\s+thumbnail)?$/i);
    const fallback = collapseDuplicateText(stripHtml(inner));
    const title = (altMatch && altMatch[1] || fallback || parts[2].replace(/-/g, " ")).trim();
    const defaultVariant = altMatch && altMatch[2] ? altMatch[2].trim() : "";
    const imageUrls = imageUrlsFromTag(imageTag);
    const previewUrl = imageUrls.previewUrl;
    if (!previewUrl) continue;
    const path = "/" + parts.join("/");
    const id = "cz-" + slugify(source.universe) + "-" + source.section + "-" + parts[2];
    if (!items.has(id)) {
      const defaultSlug = slugify(defaultVariant);
      items.set(id, {
        id, title, universe: source.universe,
        moodType: source.section === "scenes" ? "Scene" : "Map",
        category: "",
        tags: ["Czepeku", source.universe, source.section === "scenes" ? "Scene" : "Map"],
        previewUrl,
        fullUrl: imageUrls.fullUrl || previewUrl,
        sourceUrl: SITE + (defaultSlug ? path + "/" + defaultSlug : path),
        catalogPath: path, defaultVariant, variantsCount: null
      });
    }
  }
  return [...items.values()];
}
function directMediaUrl(html) {
  const decoded = String(html || "").replace(/\\\//g, "/").replace(/&amp;/g, "&");
  const match = decoded.match(/https?:\/\/[^"'\\\s<>]+?\.(?:webm|mp4|m4v|mov|ogv)(?:\?[^"'\\\s<>]*)?/i);
  return match ? match[0] : "";
}
function extractTags(html, basePath) {
  const prefix = basePath.replace(/\/$/, "");
  const result = new Set();
  for (const match of html.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)) {
    const href = attr(match[1], "href");
    if (!href) continue;
    let parsed;
    try { parsed = new URL(href, SITE); } catch { continue; }
    if (parsed.hostname !== "www.czepeku.com") continue;
    const path = parsed.pathname.toLowerCase();
    const base = prefix.toLowerCase();
    if (!path.startsWith(base + "/")) continue;
    const rest = path.slice(base.length + 1);
    if (!/^(?:themes|series|search)\//.test(rest)) continue;
    const label = stripHtml(match[2]);
    if (label && label.length <= 50 && !/^(themes|series|search|all|new|view all)$/i.test(label)) result.add(label);
  }
  return [...result].sort((a, b) => a.localeCompare(b, "en", { sensitivity: "base" })).slice(0, 30);
}
function parseVariants(html, basePath, type) {
  const titleMatch = /<h1\b[^>]*>([\s\S]*?)<\/h1>/i.exec(html);
  const subtitleMatch = /<h2\b[^>]*>([\s\S]*?)<\/h2>/i.exec(html);
  const parentTitle = stripHtml(titleMatch && titleMatch[1] || "");
  const escapedTitle = parentTitle.replace(/[.*+?^$()|[\]\\]/g, "\\$&");
  const mediaUrl = directMediaUrl(html);
  const variants = new Map();
  for (const match of html.matchAll(/<img\b[^>]*>/gi)) {
    const tag = match[0];
    const alt = attr(tag, "alt");
    const pattern = new RegExp("^" + escapedTitle + "\\s+(?:map|scene),\\s*(.+?)\\s+variant\\s+thumbnail$", "i");
    const altMatch = alt.match(pattern);
    if (!altMatch) continue;
    const name = altMatch[1].trim();
    const imageUrls = imageUrlsFromTag(tag);
    const previewUrl = imageUrls.previewUrl;
    if (!name || !previewUrl) continue;
    const slug = slugify(name);
    if (!slug || variants.has(slug)) continue;
    variants.set(slug, {
      id: basePath + "/" + slug, name, slug,
      title: parentTitle + " – " + name, moodType: type,
      previewUrl, fullUrl: imageUrls.fullUrl || previewUrl, mediaUrl: mediaUrl || "",
      animated: /animated/i.test(name) || Boolean(mediaUrl),
      sourceUrl: SITE + basePath + "/" + slug
    });
  }
  if (!variants.size) {
    const title = parentTitle || basePath.split("/").pop().replace(/-/g, " ");
    const variantName = stripHtml(subtitleMatch && subtitleMatch[1] || "");
    const imageTags = [...html.matchAll(/<img\b[^>]*>/gi)].map(match => match[0]);
    const image = imageTags.find(tag => /variant/i.test(attr(tag, "alt"))) || imageTags[0] || "";
    const imageUrls = imageUrlsFromTag(image);
    const previewUrl = imageUrls.previewUrl;
    if (previewUrl) {
      const name = variantName || "Standard";
      const slug = slugify(name) || "standard";
      variants.set(slug, {
        id: basePath + "/" + slug, name, slug, title: title + " – " + name,
        moodType: type, previewUrl, fullUrl: imageUrls.fullUrl || previewUrl, mediaUrl: mediaUrl || "",
        animated: /animated/i.test(name) || Boolean(mediaUrl),
        sourceUrl: SITE + basePath + "/" + slug
      });
    }
  }
  return {
    title: parentTitle || basePath.split("/").pop().replace(/-/g, " "),
    selectedVariant: stripHtml(subtitleMatch && subtitleMatch[1] || ""),
    variants: [...variants.values()], mediaUrl,
    tags: extractTags(html, basePath)
  };
}
function validCatalogPath(value) {
  return typeof value === "string" && value.length <= 300 &&
    /^\/(?:fantasy|scifi)\/(?:maps|scenes)\/[a-z0-9-]+$/i.test(value);
}
export default {
  async fetch(request) {
    const url = new URL(request.url);
    if (request.method === "OPTIONS") return new Response(null, { headers: {
      "access-control-allow-origin": "*",
      "access-control-allow-methods": "GET,OPTIONS",
      "access-control-allow-headers": "Content-Type"
    }});
    if (url.pathname === "/health") return json({ ok: true, worker: "neuvia-mood-catalog", version: 4 });
    if (request.method !== "GET") return json({ error: "Method not allowed" }, 405);
    if (url.pathname === "/catalog") {
      const results = await Promise.all(SOURCES.map(async source => {
        try {
          const fetched = await fetchHtml(source.path);
          if (fetched.status < 200 || fetched.status >= 300) return { source, ok: false, status: fetched.status, items: [] };
          return { source, ok: true, status: fetched.status, items: parseDirectory(fetched.html, source) };
        } catch (error) {
          return { source, ok: false, status: 0, error: String(error && error.message || error), items: [] };
        }
      }));
      const items = results.flatMap(result => result.items);
      const unique = [...new Map(items.map(item => [item.id, item])).values()]
        .sort((a, b) => a.title.localeCompare(b.title, "en", { sensitivity: "base" }));
      return json({ items: unique, count: unique.length, sources: results.map(result => ({
        universe: result.source.universe, type: result.source.section, path: result.source.path,
        ok: result.ok, status: result.status, count: result.items.length,
        ...(result.error ? { error: result.error } : {})
      })), refreshedAt: new Date().toISOString() });
    }
    if (url.pathname === "/variants") {
      const path = url.searchParams.get("path") || "";
      if (!validCatalogPath(path)) return json({ error: "Ungültiger Katalogpfad." }, 400);
      try {
        const fetched = await fetchHtml(path);
        if (fetched.status < 200 || fetched.status >= 300) return json({ error: "Czepeku-Seite konnte nicht geladen werden.", status: fetched.status }, 502);
        const type = path.split("/")[2] === "scenes" ? "Scene" : "Map";
        const parsed = parseVariants(fetched.html, path, type);
        return json({ ...parsed, count: parsed.variants.length, sourceUrl: fetched.url });
      } catch (error) {
        return json({ error: String(error && error.message || error) }, 502);
      }
    }
    return json({ error: "Not found" }, 404);
  }
};
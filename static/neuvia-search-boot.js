(() => {
  const findActiveContainer = () =>
    document.querySelector(".search .search-container.active");

  const closeSearch = (container, returnFocus = false) => {
    const search = container?.closest(".search");
    if (!search) return;

    const button = search.querySelector(".search-button");
    const input = search.querySelector(".search-bar");
    const layout = search.querySelector(".search-layout");
    const sidebar = container.closest(".sidebar");

    container.classList.remove("active");
    button?.setAttribute("aria-expanded", "false");
    if (sidebar) sidebar.style.zIndex = "";

    if (input) input.value = "";
    layout?.classList.remove("display-results");
    for (const element of search.querySelectorAll(
      ".results-container, .preview-container, .tag-suggestions, .ghost-text",
    )) {
      element.replaceChildren();
      if (element.classList.contains("tag-suggestions")) {
        element.style.display = "none";
      }
    }

    if (returnFocus) button?.focus();
  };

  const openSearchImmediately = (event) => {
    const origin = event.target instanceof Element ? event.target : null;
    const button = origin?.closest(".search .search-button");
    if (!button) return;

    const search = button.closest(".search");
    const container = search?.querySelector(".search-container");
    const input = search?.querySelector(".search-bar");
    if (!container || !input) return;

    container.classList.add("active");
    button.setAttribute("aria-expanded", "true");
    requestAnimationFrame(() => input.focus());
  };

  const closeSearchOnOutsideClick = (event) => {
    const container = findActiveContainer();
    const target = event.target instanceof Element ? event.target : null;
    if (!container || !target) return;
    const searchPanel = container.querySelector(".search-space");
    if (searchPanel?.contains(target)) return;

    // The toolbar button opens the panel; it is not considered an outside click.
    if (target.closest(".search .search-button")) return;
    closeSearch(container);
  };

  const closeSearchOnEscape = (event) => {
    if (event.key !== "Escape") return;
    const container = findActiveContainer();
    if (!container) return;
    event.preventDefault();
    closeSearch(container, true);
  };

  document.addEventListener("click", openSearchImmediately, true);
  document.addEventListener("click", closeSearchOnOutsideClick, true);
  document.addEventListener("keydown", closeSearchOnEscape, true);

  // Quartz normally wires the input after its search index has loaded.
  // If that initialization fails, use the same generated content index directly.
  let fallbackIndexPromise = null;
  let fallbackTimer = null;
  let fallbackGeneration = 0;

  const normalize = (value) =>
    String(value ?? "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/ß/g, "ss")
      .toLowerCase();

  const loadFallbackIndex = (forceReload = false) => {
    if (forceReload || !fallbackIndexPromise) {
      const url = new URL("/static/contentIndex.json", window.location.origin);
      fallbackIndexPromise = fetch(url.toString(), {
        cache: forceReload ? "reload" : "no-cache",
        credentials: "same-origin",
      })
        .then((response) => {
          if (!response.ok) {
            throw new Error("Der Suchindex antwortet mit HTTP " + response.status + ".");
          }
          return response.json();
        })
        .then((data) => {
          const root =
            data?.content && typeof data.content === "object" ? data.content : data;
          if (!root || typeof root !== "object" || Array.isArray(root)) {
            throw new Error("Der Suchindex hat ein ungültiges Format.");
          }
          return Object.entries(root)
            .filter(([, item]) => item && typeof item === "object")
            .map(([key, item]) => ({
              slug: String(item.slug || key),
              title: String(item.title || item.slug || key),
              content: String(item.content || ""),
              tags: Array.isArray(item.tags) ? item.tags.map(String) : [],
            }));
        })
        .catch((error) => {
          fallbackIndexPromise = null;
          throw error;
        });
    }
    return fallbackIndexPromise;
  };

  const ensureResultsContainer = (layout) => {
    let results = layout.querySelector(".results-container");
    if (!results) {
      results = document.createElement("div");
      results.className = "results-container";
      results.setAttribute("role", "listbox");
      results.setAttribute("aria-label", "Suchergebnisse");
      layout.appendChild(results);
    }
    return results;
  };

  const stripMarkdown = (value) =>
    String(value || "")
      .replace(/```[\s\S]*?```/g, " ")
      .replace(/!\[([^\]]*)\]\([^)]+\)/g, "$1")
      .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
      .replace(/<[^>]+>/g, " ")
      .replace(/[#>*_~`|]/g, " ")
      .replace(/\s+/g, " ")
      .trim();

  const showMessage = (results, title, description) => {
    results.replaceChildren();
    const card = document.createElement("div");
    card.className = "result-card no-match";
    const heading = document.createElement("h3");
    heading.className = "card-title";
    heading.textContent = title;
    const detail = document.createElement("p");
    detail.className = "card-description";
    detail.textContent = description;
    card.append(heading, detail);
    results.appendChild(card);
  };

  async function runFallbackSearch(input, term, generation, forceReload = false) {
    const search = input.closest(".search");
    const layout = search?.querySelector(".search-layout");
    if (!layout) return;

    const results = ensureResultsContainer(layout);
    results.dataset.neuviaFallback = "true";
    layout.classList.add("display-results");

    try {
      const entries = await loadFallbackIndex(forceReload);
      if (generation !== fallbackGeneration || input.value.trim() !== term) return;

      const tokens = normalize(term).split(/\s+/).filter(Boolean);
      const matches = [];

      for (const entry of entries) {
        const title = normalize(entry.title);
        const content = normalize(entry.content);
        const tags = normalize(entry.tags.join(" "));
        const searchable = [title, content, tags];
        if (!tokens.every((token) => searchable.some((field) => field.includes(token)))) {
          continue;
        }

        let score = 0;
        for (const token of tokens) {
          if (title.startsWith(token)) score += 0;
          else if (title.includes(token)) score += 1;
          else if (tags.includes(token)) score += 3;
          else score += 6;
        }
        matches.push({ ...entry, score });
      }

      matches.sort(
        (a, b) => a.score - b.score || a.title.localeCompare(b.title, "de"),
      );
      results.replaceChildren();

      if (matches.length === 0) {
        showMessage(results, "Keine Ergebnisse.", "Versuche einen anderen Suchbegriff.");
        return;
      }

      for (const entry of matches.slice(0, 8)) {
        const link = document.createElement("a");
        link.className = "result-card";
        link.setAttribute("role", "option");
        const slug = entry.slug.replace(/^\/+/, "");
        link.href = "/" + slug.split("/").map((segment) => encodeURIComponent(segment)).join("/");

        const heading = document.createElement("h3");
        heading.className = "card-title";
        heading.textContent = entry.title;
        const paragraph = document.createElement("p");
        paragraph.className = "card-description";

        const plainContent = stripMarkdown(entry.content);
        const normalizedContent = normalize(plainContent);
        const matchedToken = tokens.find((token) => normalizedContent.includes(token));
        const matchPosition = matchedToken ? normalizedContent.indexOf(matchedToken) : -1;
        const start = matchPosition > 70 ? matchPosition - 70 : 0;
        let snippet = plainContent.slice(start, start + 190);
        if (start > 0) snippet = "… " + snippet;
        if (start + 190 < plainContent.length) snippet += " …";
        paragraph.textContent = snippet || entry.tags.join(" · ");

        link.append(heading, paragraph);
        results.appendChild(link);
      }
    } catch (error) {
      if (generation !== fallbackGeneration) return;
      showMessage(
        results,
        "Suche konnte nicht geladen werden.",
        error instanceof Error ? error.message : "Der Suchindex ist momentan nicht erreichbar.",
      );

      const card = results.querySelector(".no-match");
      const retry = document.createElement("button");
      retry.type = "button";
      retry.className = "search-retry";
      retry.textContent = "Suchindex erneut laden";
      retry.addEventListener("click", () => {
        const nextGeneration = ++fallbackGeneration;
        void runFallbackSearch(input, input.value.trim(), nextGeneration, true);
      });
      card?.appendChild(retry);
    }
  }

  document.addEventListener(
    "input",
    (event) => {
      const target = event.target instanceof Element ? event.target : null;
      const input = target?.closest(".search .search-bar");
      if (!(input instanceof HTMLInputElement)) return;

      const term = input.value.trim();
      const generation = ++fallbackGeneration;
      if (fallbackTimer !== null) window.clearTimeout(fallbackTimer);
      if (!term) return;

      // Let Quartz render first when its own search handler is healthy.
      fallbackTimer = window.setTimeout(() => {
        const layout = input.closest(".search")?.querySelector(".search-layout");
        const results = layout?.querySelector(".results-container");
        if (results && results.childElementCount > 0) return;
        void runFallbackSearch(input, term, generation);
      }, 700);
    },
    true,
  );

  // Android/iOS keyboard "Search" should open the first fallback result as well.
  document.addEventListener(
    "keydown",
    (event) => {
      const target = event.target instanceof Element ? event.target : null;
      const input = target?.closest(".search .search-bar");
      if (!(input instanceof HTMLInputElement) || event.key !== "Enter" || event.isComposing) {
        return;
      }

      const results = input.closest(".search")?.querySelector(".results-container");
      if (results?.dataset.neuviaFallback !== "true") return;
      const firstResult = results.querySelector("a.result-card:not(.no-match)");
      if (!firstResult) return;

      event.preventDefault();
      event.stopPropagation();
      firstResult.click();
    },
    true,
  );
})();
(() => {
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

  const closeSearchImmediately = (event) => {
    if (event.key !== "Escape") return;
    const container = document.querySelector(".search .search-container.active");
    if (!container) return;

    container.classList.remove("active");
    const button = container.closest(".search")?.querySelector(".search-button");
    button?.setAttribute("aria-expanded", "false");
  };

  document.addEventListener("click", openSearchImmediately, true);
  document.addEventListener("keydown", closeSearchImmediately, true);

  // If someone starts typing before Quartz finishes building its index,
  // replay the query once Quartz has attached its normal search listeners.
  const search = document.querySelector(".search");
  if (!search) return;

  const replayWhenReady = () => {
    const results = search.querySelector(".search-layout .results-container");
    const input = search.querySelector(".search-bar");
    if (!results || !input) return false;

    observer.disconnect();
    if (input.value.trim()) {
      input.dispatchEvent(new Event("input", { bubbles: true }));
    }
    return true;
  };

  const observer = new MutationObserver(replayWhenReady);
  observer.observe(search, { childList: true, subtree: true });
  replayWhenReady();
})();

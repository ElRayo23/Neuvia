(() => {
  "use strict";

  const API = "https://neuvia-admin-api.forkleafcustom.workers.dev";
  const SESSION_KEY = "neuviaAdminSession";
  const ADMIN_SCRIPT = Array.from(document.scripts).find((script) => script.src.includes("neuvia-admin.js"));
  const STATIC_BASE = ADMIN_SCRIPT ? new URL(".", ADMIN_SCRIPT.src).href : new URL("/static/", location.origin).href;
  const SITE_BASE = new URL("../", STATIC_BASE).href;
  const LINK_URL = new URL("neuvia-link-index.json", STATIC_BASE).href;
  const BUILD_URL = new URL("neuvia-build.json", STATIC_BASE).href;
  const STATE_KEY = "__neuviaWorkspace";

  if (window[STATE_KEY]) {
    window[STATE_KEY].open();
    return;
  }

  const token = () => sessionStorage.getItem(SESSION_KEY) || "";
  const normalize = (value) => String(value || "").normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("de").trim();
  const encodePath = (path) => path.split("/").map(encodeURIComponent).join("/");
  const basename = (path) => path.split("/").pop() || path;
  const extension = (path) => path.includes(".") ? path.split(".").pop().toLowerCase() : "";

  async function request(path, options = {}) {
    const headers = { ...(options.headers || {}) };
    if (token()) headers.Authorization = "Bearer " + token();
    if (options.body && !(options.body instanceof FormData) && !headers["Content-Type"]) {
      headers["Content-Type"] = "text/plain;charset=UTF-8";
    }
    const result = await fetch(API + path, { ...options, headers });
    const data = await result.json().catch(() => ({}));
    if (!result.ok) {
      const error = new Error(data.error || "Anfrage fehlgeschlagen (HTTP " + result.status + ").");
      error.status = result.status;
      throw error;
    }
    return data;
  }

  const style = document.createElement("style");
  style.id = "neuvia-workspace-style";
  style.textContent = [
    "#neuvia-workspace{position:fixed;inset:0;z-index:100010;background:var(--light,#faf8f8);color:var(--dark,#2b2b2b);font:14px/1.45 system-ui,sans-serif;}",
    "#neuvia-workspace *{box-sizing:border-box;}",
    "#neuvia-workspace .nw-shell{display:grid;grid-template-columns:280px minmax(0,1fr);height:100%;min-height:0;}",
    "#neuvia-workspace .nw-sidebar{display:flex;flex-direction:column;min-width:0;min-height:0;border-right:1px solid var(--lightgray,#ddd);background:var(--light,#faf8f8);}",
    "#neuvia-workspace .nw-brand{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:15px 14px;border-bottom:1px solid var(--lightgray,#ddd);font-weight:750;font-size:16px;}",
    "#neuvia-workspace .nw-brand small{display:block;font-size:10px;font-weight:500;opacity:.6;letter-spacing:.08em;text-transform:uppercase;}",
    "#neuvia-workspace button,#neuvia-workspace input{font:inherit;}",
    "#neuvia-workspace button{cursor:pointer;}",
    "#neuvia-workspace .nw-actions{display:flex;gap:7px;padding:12px 10px 8px;}",
    "#neuvia-workspace .nw-button{border:1px solid var(--lightgray,#ddd);border-radius:7px;padding:7px 10px;background:var(--light,#fff);color:inherit;}",
    "#neuvia-workspace .nw-button:hover{background:var(--highlight,rgba(120,130,140,.14));}",
    "#neuvia-workspace .nw-primary{background:var(--secondary,#284b63);border-color:var(--secondary,#284b63);color:#fff;}",
    "#neuvia-workspace .nw-primary:hover{filter:brightness(1.08);background:var(--secondary,#284b63);}",
    "#neuvia-workspace .nw-search{margin:5px 10px 10px;width:calc(100% - 20px);padding:8px 10px;border:1px solid var(--lightgray,#ddd);border-radius:7px;background:transparent;color:inherit;outline:none;}",
    "#neuvia-workspace .nw-search:focus,#neuvia-workspace .nw-dialog input:focus{border-color:var(--secondary,#284b63);}",
    "#neuvia-workspace .nw-tree{overflow:auto;min-height:0;flex:1;padding:2px 7px 16px;}",
    "#neuvia-workspace .nw-tree-row{display:flex;align-items:center;gap:7px;width:100%;min-width:0;padding:5px 7px;border:0;border-radius:5px;background:transparent;color:inherit;text-align:left;}",
    "#neuvia-workspace .nw-tree-row:hover{background:var(--highlight,rgba(120,130,140,.14));}",
    "#neuvia-workspace .nw-tree-row[aria-current=true]{background:var(--highlight,rgba(120,130,140,.2));font-weight:650;}",
    "#neuvia-workspace .nw-tree-row .nw-name{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}",
    "#neuvia-workspace .nw-tree-children{padding-left:15px;}",
    "#neuvia-workspace .nw-muted{opacity:.58;font-size:11px;}",
    "#neuvia-workspace .nw-main{display:flex;flex-direction:column;min-width:0;min-height:0;}",
    "#neuvia-workspace .nw-topbar{display:flex;align-items:center;justify-content:space-between;gap:12px;min-height:58px;padding:9px 16px;border-bottom:1px solid var(--lightgray,#ddd);}",
    "#neuvia-workspace .nw-current{min-width:0;overflow:hidden;}",
    "#neuvia-workspace .nw-current-title{font-size:14px;font-weight:700;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}",
    "#neuvia-workspace .nw-current-path{font-size:11px;opacity:.58;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}",
    "#neuvia-workspace .nw-top-actions{display:flex;align-items:center;gap:7px;flex-shrink:0;}",
    "#neuvia-workspace .nw-editor-wrap{position:relative;display:flex;flex:1;min-height:0;}",
    "#neuvia-workspace .nw-editor{display:block;width:100%;height:100%;min-height:0;resize:none;border:0;outline:0;padding:30px clamp(18px,5vw,64px) 48px;background:var(--light,#faf8f8);color:var(--dark,#2b2b2b);font:14px/1.72 ui-monospace,SFMono-Regular,Consolas,monospace;tab-size:2;white-space:pre;overflow:auto;}",
    "#neuvia-workspace .nw-editor::placeholder{color:var(--gray,#999);}",
    "#neuvia-workspace .nw-drop-hint{display:none;position:absolute;inset:12px;z-index:3;align-items:center;justify-content:center;border:2px dashed var(--secondary,#284b63);border-radius:12px;background:var(--light,#faf8f8);opacity:.94;font-size:17px;font-weight:650;pointer-events:none;}",
    "#neuvia-workspace .nw-editor-wrap.nw-drag .nw-drop-hint{display:flex;}",
    "#neuvia-workspace .nw-suggestions{position:absolute;left:clamp(18px,5vw,64px);bottom:15px;z-index:5;width:min(520px,calc(100% - 36px));max-height:260px;overflow:auto;padding:5px;border:1px solid var(--lightgray,#bbb);border-radius:8px;background:var(--light,#fff);box-shadow:0 7px 24px #0003;}",
    "#neuvia-workspace .nw-suggestions[hidden]{display:none;}",
    "#neuvia-workspace .nw-suggestion{display:flex;justify-content:space-between;gap:12px;width:100%;padding:7px 8px;border:0;border-radius:5px;background:transparent;color:inherit;text-align:left;}",
    "#neuvia-workspace .nw-suggestion[aria-selected=true],#neuvia-workspace .nw-suggestion:hover{background:var(--highlight,rgba(120,130,140,.18));}",
    "#neuvia-workspace .nw-suggestion-path{max-width:52%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:11px;opacity:.58;}",
    "#neuvia-workspace .nw-footer{display:flex;justify-content:space-between;gap:10px;padding:7px 14px;border-top:1px solid var(--lightgray,#ddd);font-size:11px;opacity:.72;}",
    "#neuvia-workspace .nw-dialog-backdrop{position:fixed;inset:0;z-index:10;display:flex;align-items:center;justify-content:center;padding:16px;background:#0008;}",
    "#neuvia-workspace .nw-dialog{width:min(440px,100%);padding:20px;border:1px solid var(--lightgray,#ddd);border-radius:12px;background:var(--light,#faf8f8);box-shadow:0 12px 38px #0005;}",
    "#neuvia-workspace .nw-dialog h2{margin:0 0 14px;font-size:18px;}",
    "#neuvia-workspace .nw-dialog label{display:block;margin:12px 0 5px;font-size:12px;opacity:.72;}",
    "#neuvia-workspace .nw-dialog input{width:100%;padding:9px 10px;border:1px solid var(--lightgray,#aaa);border-radius:7px;background:transparent;color:inherit;}",
    "#neuvia-workspace .nw-dialog-actions{display:flex;justify-content:flex-end;gap:8px;margin-top:18px;}",
    "#neuvia-workspace .nw-error{min-height:18px;margin-top:9px;color:#c33;font-size:12px;}",
    "#neuvia-workspace .nw-empty{padding:13px 9px;color:var(--darkgray,#666);font-size:12px;}",
    "#neuvia-workspace button:disabled{opacity:.5;cursor:wait;}",
    "@media(max-width:700px){#neuvia-workspace .nw-shell{grid-template-columns:190px minmax(0,1fr);}#neuvia-workspace .nw-topbar{align-items:flex-start;flex-direction:column;padding:8px 10px;}#neuvia-workspace .nw-top-actions{width:100%;}#neuvia-workspace .nw-top-actions button{flex:1;padding:7px 5px;font-size:12px;}#neuvia-workspace .nw-editor{padding:20px 14px 36px;font-size:13px;}#neuvia-workspace .nw-actions{flex-wrap:wrap;}#neuvia-workspace .nw-actions button{flex:1;font-size:12px;padding:7px 5px;}}",
    "@media(max-width:480px){#neuvia-workspace .nw-shell{grid-template-columns:145px minmax(0,1fr);}#neuvia-workspace .nw-brand{padding:11px 8px;font-size:14px;}#neuvia-workspace .nw-current-path{display:none;}#neuvia-workspace .nw-actions{padding:8px 5px;}#neuvia-workspace .nw-search{margin:4px 5px 7px;width:calc(100% - 10px);}}"
  ].join("\n");
  document.head.appendChild(style);

  let overlay = null;
  let treeItems = [];
  let linkItems = [];
  let currentPath = "";
  let currentSha = "";
  let savedContent = "";
  let saveTimer = null;
  let savingPromise = null;
  let activeFolder = "";
  let suggestionItems = [];
  let selectedSuggestion = 0;
  let isClosing = false;

  function element(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function status(message, kind = "normal") {
    if (!overlay) return;
    const node = overlay.querySelector(".nw-status");
    if (node) {
      node.textContent = message;
      node.dataset.kind = kind;
      node.style.color = kind === "error" ? "#c33" : (kind === "success" ? "var(--tertiary,#39765e)" : "");
    }
  }

  function currentIsDirty() {
    const editor = overlay && overlay.querySelector(".nw-editor");
    return !!(editor && currentPath && editor.value !== savedContent);
  }

  function scheduleSave() {
    if (saveTimer) clearTimeout(saveTimer);
    if (!currentPath || !currentIsDirty()) return;
    status("Nicht synchronisiert", "normal");
    saveTimer = setTimeout(() => saveCurrent().catch(() => {}), 2800);
  }

  async function saveCurrent() {
    if (!overlay || !currentPath) return true;
    if (saveTimer) {
      clearTimeout(saveTimer);
      saveTimer = null;
    }
    const editor = overlay.querySelector(".nw-editor");
    if (!editor) return true;
    if (savingPromise) {
      await savingPromise;
      if (editor.value !== savedContent) return saveCurrent();
      return true;
    }
    const snapshot = editor.value;
    if (snapshot === savedContent) {
      status("Synchronisiert", "success");
      return true;
    }
    const path = currentPath;
    const version = currentSha;
    status("Synchronisiere mit GitHub …");
    const promise = (async () => {
      const data = await request("/api/save", {
        method: "POST",
        body: JSON.stringify({
          path,
          content: snapshot,
          sha: version,
          message: "Neuvia-Notiz synchronisiert"
        })
      });
      if (currentPath === path) {
        savedContent = snapshot;
        currentSha = data.sha || currentSha;
        if (editor.value === snapshot) status("In GitHub gesichert", "success");
        else scheduleSave();
      }
      return true;
    })();
    savingPromise = promise;
    try {
      return await promise;
    } catch (error) {
      status(error.message, "error");
      if (error.status === 409) status("Versionskonflikt: Bitte Notiz neu laden. Deine lokale Eingabe bleibt im Editor.", "error");
      throw error;
    } finally {
      savingPromise = null;
    }
  }

  function fallbackTitle(path) {
    const fileTitle = basename(path).replace(/\.md$/i, "");
    if (fileTitle.toLowerCase() === "index") return path.split("/").slice(-2, -1)[0] || "Neuvia";
    return fileTitle;
  }

  function getLinkIndexTitle(path) {
    const item = linkItems.find((entry) => entry.path === path);
    return item && item.title ? item.title : fallbackTitle(path);
  }

  function makeFolderTree() {
    const root = { name: "", path: "", folders: new Map(), files: [] };
    function ensureFolder(path) {
      if (!path) return root;
      let node = root;
      let current = "";
      for (const segment of path.split("/")) {
        current = current ? current + "/" + segment : segment;
        if (!node.folders.has(segment)) node.folders.set(segment, {
          name: segment, path: current, folders: new Map(), files: []
        });
        node = node.folders.get(segment);
      }
      return node;
    }
    for (const item of treeItems) {
      if (item.type === "folder") ensureFolder(item.path);
      else {
        const parts = item.path.split("/");
        const fileName = parts.pop();
        const parent = ensureFolder(parts.join("/"));
        parent.files.push({ ...item, name: fileName });
      }
    }
    return root;
  }

  function renderTree() {
    if (!overlay) return;
    const container = overlay.querySelector(".nw-tree");
    const query = normalize(overlay.querySelector(".nw-search").value);
    container.replaceChildren();

    if (query) {
      const matches = treeItems.filter((item) => item.type === "file" && (
        normalize(item.path).includes(query) || normalize(getLinkIndexTitle(item.path)).includes(query)
      )).slice(0, 100);
      if (!matches.length) container.appendChild(element("div", "nw-empty", "Keine passenden Dateien gefunden."));
      for (const item of matches) {
        const row = element("button", "nw-tree-row");
        row.type = "button";
        row.setAttribute("aria-current", item.path === currentPath ? "true" : "false");
        row.append(element("span", "", extension(item.path) === "md" ? "▤" : "▧"));
        const name = element("span", "nw-name", getLinkIndexTitle(item.path));
        row.append(name);
        row.title = item.path;
        row.addEventListener("click", () => openFile(item));
        container.append(row);
        const pathLine = element("div", "nw-muted", item.path);
        pathLine.style.padding = "0 8px 5px 27px";
        container.append(pathLine);
      }
      return;
    }

    const root = makeFolderTree();
    function addFile(item, parent) {
      const row = element("button", "nw-tree-row");
      row.type = "button";
      row.setAttribute("aria-current", item.path === currentPath ? "true" : "false");
      row.style.paddingLeft = "7px";
      const ext = extension(item.path);
      row.append(element("span", "", ext === "md" ? "▤" : (IMAGE_TYPES.has(ext) ? "▧" : "▣")));
      row.append(element("span", "nw-name", ext === "md" ? getLinkIndexTitle(item.path) : item.name));
      row.title = item.path;
      row.addEventListener("click", () => openFile(item));
      parent.append(row);
    }
    function addFolder(folder, parent) {
      const wrapper = element("div", "nw-tree-folder");
      const row = element("button", "nw-tree-row");
      row.type = "button";
      const arrow = element("span", "", "▸");
      const name = element("span", "nw-name", folder.name);
      row.append(arrow, name);
      row.title = folder.path;
      const children = element("div", "nw-tree-children");
      children.hidden = true;
      row.addEventListener("click", () => {
        children.hidden = !children.hidden;
        arrow.textContent = children.hidden ? "▸" : "▾";
        activeFolder = folder.path;
      });
      wrapper.append(row, children);
      parent.append(wrapper);
      for (const child of Array.from(folder.folders.values()).sort((a,b)=>a.name.localeCompare(b.name,"de",{sensitivity:"base"}))) addFolder(child, children);
      folder.files.sort((a,b)=>a.name.localeCompare(b.name,"de",{sensitivity:"base",numeric:true}));
      for (const file of folder.files) addFile(file, children);
    }
    for (const folder of Array.from(root.folders.values()).sort((a,b)=>a.name.localeCompare(b.name,"de",{sensitivity:"base"}))) addFolder(folder, container);
    root.files.sort((a,b)=>a.name.localeCompare(b.name,"de",{sensitivity:"base",numeric:true}));
    for (const file of root.files) addFile(file, container);
    if (!container.childElementCount) container.appendChild(element("div", "nw-empty", "Keine Notizen gefunden."));
  }

  const IMAGE_TYPES = new Set(["png", "jpg", "jpeg", "webp", "gif", "avif"]);

  async function loadTree() {
    status("Lade Ordner und Notizen …");
    const data = await request("/api/tree?all=1");
    treeItems = Array.isArray(data.items) ? data.items : [];
    const linkResponse = await fetch(LINK_URL, { cache: "no-store" }).catch(() => null);
    linkItems = linkResponse && linkResponse.ok ? await linkResponse.json().catch(() => []) : [];
    renderTree();
    status(treeItems.filter((item) => item.type === "file" && extension(item.path) === "md").length + " Notizen", "success");
  }

  function updateCurrentHeader() {
    const title = overlay.querySelector(".nw-current-title");
    const path = overlay.querySelector(".nw-current-path");
    if (!currentPath) {
      title.textContent = "Keine Notiz geöffnet";
      path.textContent = "Wähle links eine Markdown-Datei aus";
      return;
    }
    title.textContent = getLinkIndexTitle(currentPath);
    path.textContent = currentPath;
  }

  async function openFile(item) {
    if (item.type !== "file") return;
    const ext = extension(item.path);
    if (ext !== "md") {
      const url = new URL(encodePath(item.path), SITE_BASE).href;
      window.open(url, "_blank", "noopener");
      return;
    }
    if (currentPath === item.path) return;
    try {
      await saveCurrent();
      status("Öffne " + item.name + " …");
      const data = await request("/api/file?path=" + encodeURIComponent(item.path));
      currentPath = item.path;
      currentSha = data.sha || "";
      savedContent = data.content || "";
      const editor = overlay.querySelector(".nw-editor");
      editor.value = savedContent;
      editor.disabled = false;
      editor.focus();
      updateCurrentHeader();
      renderTree();
      status("Synchronisiert", "success");
    } catch (error) {
      status(error.message, "error");
    }
  }

  function resolveWikiTarget(rawTarget) {
    const target = String(rawTarget || "").split("|")[0].split("#")[0].trim();
    if (!target) return null;
    const q = normalize(target.replace(/\.md$/i, "").replace(/\/+$/, ""));
    const mdFiles = treeItems.filter((item) => item.type === "file" && extension(item.path) === "md");
    const candidates = [];
    for (const item of linkItems) {
      let score = 99;
      if (normalize(item.target) === q) score = 0;
      else if (normalize(String(item.path || "").replace(/\.md$/i, "")) === q) score = 1;
      else if (normalize(item.title) === q) score = 2;
      else if ((item.aliases || []).some((alias) => normalize(alias) === q)) score = 3;
      if (score < 99) candidates.push({ path: item.path, score });
    }
    for (const item of mdFiles) {
      const noExt = item.path.replace(/\.md$/i, "");
      const base = basename(noExt);
      const folderIndexName = base.toLowerCase() === "index" ? noExt.split("/").slice(-2, -1)[0] : "";
      let score = 99;
      if (normalize(noExt) === q) score = 1;
      else if (normalize(base) === q || (folderIndexName && normalize(folderIndexName) === q)) score = 4;
      if (score < 99) candidates.push({ path: item.path, score });
    }
    candidates.sort((a,b)=>a.score-b.score);
    if (!candidates.length) return null;
    const bestScore = candidates[0].score;
    const best = Array.from(new Set(candidates.filter((x)=>x.score===bestScore).map((x)=>x.path)));
    return best.length === 1 ? best[0] : null;
  }

  function openWikiLinkAtCursor() {
    const editor = overlay.querySelector(".nw-editor");
    const cursor = editor.selectionStart;
    const value = editor.value;
    const start = value.lastIndexOf("[[", cursor);
    if (start < 0) return;
    const end = value.indexOf("]]", start + 2);
    if (end < 0 || cursor < start || cursor > end + 2) return;
    const target = value.slice(start + 2, end);
    const path = resolveWikiTarget(target);
    if (!path) {
      status("Verlinkte Notiz nicht gefunden oder mehrdeutig: " + target.split("|")[0], "error");
      return;
    }
    openFile({ path, type: "file", name: basename(path) });
  }

  function getActiveLink() {
    const editor = overlay.querySelector(".nw-editor");
    const cursor = editor.selectionStart;
    if (editor.selectionEnd !== cursor) return null;
    const before = editor.value.slice(0, cursor);
    const start = before.lastIndexOf("[[");
    if (start < 0 || before.slice(start + 2).includes("]]") || before.slice(start + 2).includes("\n")) return null;
    return { start, end: cursor, query: before.slice(start + 2) };
  }

  function buildLinkCandidates(query) {
    const q = normalize(query);
    const entries = [];
    const seen = new Set();
    for (const item of linkItems) {
      if (!item.path) continue;
      const title = item.title || fallbackTitle(item.path);
      const target = item.target || item.path.replace(/\.md$/i, "");
      const aliases = item.aliases || [];
      const values = [title, target, item.path, ...aliases];
      let score = 99;
      if (!q) score = 0;
      else if (values.some((value) => normalize(value).startsWith(q))) score = 0;
      else if (values.some((value) => normalize(value).includes(q))) score = 1;
      if (score < 99 && !seen.has(item.path)) {
        seen.add(item.path);
        entries.push({ title, target, path: item.path, score });
      }
    }
    for (const item of treeItems) {
      if (item.type !== "file" || extension(item.path) !== "md" || seen.has(item.path)) continue;
      const title = fallbackTitle(item.path);
      if (!q || normalize(title).includes(q) || normalize(item.path).includes(q)) {
        seen.add(item.path);
        entries.push({ title, target: item.path.replace(/\.md$/i, ""), path: item.path, score: normalize(title).startsWith(q) ? 0 : 1 });
      }
    }
    return entries.sort((a,b)=>a.score-b.score||a.title.localeCompare(b.title,"de")).slice(0,8);
  }

  function hideSuggestions() {
    const box = overlay.querySelector(".nw-suggestions");
    box.hidden = true;
    suggestionItems = [];
  }

  function chooseSuggestion(item) {
    const editor = overlay.querySelector(".nw-editor");
    const active = getActiveLink();
    if (!active || !item) return;
    const before = editor.value.slice(0, active.start);
    const after = editor.value.slice(active.end);
    const insertion = "[[" + item.target + "]]";
    editor.value = before + insertion + after;
    const cursor = before.length + insertion.length;
    editor.setSelectionRange(cursor, cursor);
    editor.dispatchEvent(new Event("input", { bubbles: true }));
    hideSuggestions();
    editor.focus();
  }

  function renderSuggestions() {
    const editor = overlay.querySelector(".nw-editor");
    const box = overlay.querySelector(".nw-suggestions");
    const active = getActiveLink();
    box.replaceChildren();
    if (!active) {
      hideSuggestions();
      return;
    }
    suggestionItems = buildLinkCandidates(active.query);
    if (!suggestionItems.length) {
      hideSuggestions();
      return;
    }
    selectedSuggestion = 0;
    for (let index = 0; index < suggestionItems.length; index++) {
      const item = suggestionItems[index];
      const button = element("button", "nw-suggestion");
      button.type = "button";
      button.setAttribute("aria-selected", index === selectedSuggestion ? "true" : "false");
      button.append(element("span", "", item.title));
      button.append(element("span", "nw-suggestion-path", item.path));
      button.addEventListener("mousedown", (event) => event.preventDefault());
      button.addEventListener("click", () => chooseSuggestion(item));
      box.append(button);
    }
    box.hidden = false;
  }

  function insertAtCursor(text) {
    const editor = overlay.querySelector(".nw-editor");
    const start = editor.selectionStart;
    const end = editor.selectionEnd;
    editor.setRangeText(text, start, end, "end");
    editor.dispatchEvent(new Event("input", { bubbles: true }));
    editor.focus();
  }

  async function uploadImages(files) {
    if (!currentPath) {
      status("Öffne zuerst eine Notiz, um dort ein Bild einzufügen.", "error");
      return;
    }
    const images = Array.from(files || []).filter((file) => file && file.type && file.type.startsWith("image/"));
    if (!images.length) {
      status("Es wurden keine unterstützten Bilddateien gefunden.", "error");
      return;
    }
    const embeds = [];
    try {
      for (const file of images) {
        status("Lade Bild hoch: " + file.name);
        const form = new FormData();
        form.append("file", file, file.name);
        const result = await request("/api/upload", { method: "POST", body: form });
        embeds.push(result.embed);
        treeItems.push({
          name: basename(result.path),
          path: result.path,
          type: "file",
          extension: extension(result.path),
          size: result.size || file.size,
        });
      }
      renderTree();
      insertAtCursor((embeds.length ? embeds.join("\n") + "\n" : ""));
      status(images.length + (images.length === 1 ? " Bild hochgeladen" : " Bilder hochgeladen") + " – synchronisiere Notiz …", "success");
      await saveCurrent();
    } catch (error) {
      status(error.message, "error");
    }
  }

  function showDialog(kind) {
    const backdrop = element("div", "nw-dialog-backdrop");
    const dialog = element("form", "nw-dialog");
    const title = kind === "folder" ? "Neuen Ordner anlegen" : "Neue Notiz erstellen";
    dialog.append(element("h2", "", title));

    let nameInput;
    let folderInput;
    if (kind === "folder") {
      const label = element("label", "", "Ordnername");
      nameInput = element("input");
      nameInput.required = true;
      nameInput.placeholder = "z. B. NPCs";
      dialog.append(label, nameInput);
    } else {
      dialog.append(element("label", "", "Notizname"));
      nameInput = element("input");
      nameInput.required = true;
      nameInput.placeholder = "z. B. Phandalin";
      dialog.append(nameInput);
      dialog.append(element("label", "", "Ordner (relativ zum Vault)"));
      folderInput = element("input");
      folderInput.value = activeFolder || (currentPath ? currentPath.split("/").slice(0, -1).join("/") : "");
      folderInput.placeholder = "z. B. Kampagnen/Phandelver";
      dialog.append(folderInput);
    }
    const error = element("div", "nw-error");
    const actions = element("div", "nw-dialog-actions");
    const cancel = element("button", "nw-button", "Abbrechen");
    cancel.type = "button";
    const submit = element("button", "nw-button nw-primary", kind === "folder" ? "Ordner anlegen" : "Notiz erstellen");
    submit.type = "submit";
    actions.append(cancel, submit);
    dialog.append(error, actions);
    backdrop.append(dialog);
    overlay.append(backdrop);
    cancel.addEventListener("click", () => backdrop.remove());
    backdrop.addEventListener("click", (event) => { if (event.target === backdrop) backdrop.remove(); });

    dialog.addEventListener("submit", async (event) => {
      event.preventDefault();
      const name = nameInput.value.trim();
      const folder = folderInput ? folderInput.value.trim().replace(/^\/+|\/+$/g, "") : "";
      if (!name) return;
      let path;
      let content;
      if (kind === "folder") {
        const folderName = name.replace(/^\/+|\/+$/g, "");
        path = [activeFolder, folderName, "index.md"].filter(Boolean).join("/");
        content = "---\ntitle: " + folderName.split("/").pop().replace(/["\r\n]/g, "") + "\n---\n\n# " + folderName.split("/").pop().replace(/[\r\n]/g, "") + "\n";
      } else {
        const filename = name.toLowerCase().endsWith(".md") ? name : name + ".md";
        path = [folder, filename].filter(Boolean).join("/");
        content = "# " + name.replace(/\.md$/i, "") + "\n";
      }
      submit.disabled = true;
      error.textContent = "";
      try {
        await saveCurrent();
        const result = await request("/api/create", {
          method: "POST",
          body: JSON.stringify({ path, content })
        });
        backdrop.remove();
        await loadTree();
        activeFolder = path.split("/").slice(0, -1).join("/");
        await openFile({ path, type: "file", name: basename(path) });
        status("Erstellt und in GitHub gesichert", "success");
      } catch (err) {
        error.textContent = err.message;
        submit.disabled = false;
      }
    });
    nameInput.focus();
  }

  async function publish() {
    const button = overlay.querySelector(".nw-publish");
    button.disabled = true;
    try {
      await saveCurrent();
      status("Starte Veröffentlichung …");
      const result = await request("/api/publish", { method: "POST", body: "{}" });
      if (!result.commit) throw new Error("GitHub hat keinen Veröffentlichungs-Commit zurückgegeben.");
      status("Website wird gebaut und veröffentlicht …");
      const deadline = Date.now() + 8 * 60 * 1000;
      while (Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 5000));
        try {
          const response = await fetch(BUILD_URL + "?t=" + Date.now(), { cache: "no-store" });
          if (!response.ok) continue;
          const build = await response.json();
          if (build.commit === result.commit) {
            status("Veröffentlicht – die öffentliche Website ist aktualisiert.", "success");
            return;
          }
        } catch {}
      }
      status("In GitHub gespeichert. Der Build läuft noch oder konnte nicht bestätigt werden.", "error");
    } catch (error) {
      status(error.message, "error");
    } finally {
      button.disabled = false;
    }
  }

  function closeWorkspace() {
    if (!overlay) return;
    if (currentIsDirty() && !window.confirm("Es gibt noch nicht synchronisierte Änderungen. Trotzdem schließen?")) return;
    isClosing = true;
    if (saveTimer) clearTimeout(saveTimer);
    overlay.remove();
    overlay = null;
    currentPath = "";
    currentSha = "";
    savedContent = "";
    if (style.isConnected) style.remove();
    window.removeEventListener("beforeunload", beforeUnload);
  }

  function beforeUnload(event) {
    if (currentIsDirty()) {
      event.preventDefault();
      event.returnValue = "";
    }
  }

  async function openWorkspace() {
    if (overlay) return;
    if (!style.isConnected) document.head.appendChild(style);
    if (!token()) {
      alert("Bitte zuerst als Administrator anmelden.");
      return;
    }
    isClosing = false;
    overlay = element("div", "");
    overlay.id = "neuvia-workspace";
    const shell = element("div", "nw-shell");
    const sidebar = element("aside", "nw-sidebar");
    const brand = element("div", "nw-brand");
    const brandLabel = element("div");
    brandLabel.append(element("div", "", "Neuvia"), element("small", "", "Workspace"));
    const close = element("button", "nw-button", "Schließen");
    close.type = "button";
    close.addEventListener("click", closeWorkspace);
    brand.append(brandLabel, close);
    sidebar.append(brand);

    const sideActions = element("div", "nw-actions");
    const newNote = element("button", "nw-button nw-primary", "+ Notiz");
    newNote.type = "button";
    newNote.addEventListener("click", () => showDialog("note"));
    const newFolder = element("button", "nw-button", "+ Ordner");
    newFolder.type = "button";
    newFolder.addEventListener("click", () => showDialog("folder"));
    sideActions.append(newNote, newFolder);
    sidebar.append(sideActions);

    const search = element("input", "nw-search");
    search.type = "search";
    search.placeholder = "Notizen durchsuchen …";
    search.setAttribute("aria-label", "Notizen durchsuchen");
    search.addEventListener("input", renderTree);
    sidebar.append(search);
    const tree = element("div", "nw-tree");
    sidebar.append(tree);

    const main = element("main", "nw-main");
    const topbar = element("div", "nw-topbar");
    const current = element("div", "nw-current");
    const currentTitle = element("div", "nw-current-title", "Keine Notiz geöffnet");
    const currentPathLabel = element("div", "nw-current-path", "Wähle links eine Markdown-Datei aus");
    current.append(currentTitle, currentPathLabel);
    const topActions = element("div", "nw-top-actions");
    const sync = element("button", "nw-button nw-sync", "Sync");
    sync.type = "button";
    sync.addEventListener("click", async () => {
      sync.disabled = true;
      try { await saveCurrent(); status("Alle Änderungen synchronisiert", "success"); }
      catch {}
      finally { sync.disabled = false; }
    });
    const publishButton = element("button", "nw-button nw-primary nw-publish", "Veröffentlichen");
    publishButton.type = "button";
    publishButton.addEventListener("click", publish);
    const website = element("button", "nw-button", "Website");
    website.type = "button";
    website.addEventListener("click", () => { location.href = SITE_BASE; });
    topActions.append(sync, publishButton, website);
    topbar.append(current, topActions);

    const editorWrap = element("div", "nw-editor-wrap");
    const dropHint = element("div", "nw-drop-hint", "Bild hier ablegen");
    const editor = element("textarea", "nw-editor");
    editor.spellcheck = false;
    editor.disabled = true;
    editor.placeholder = "Wähle links eine Notiz aus oder erstelle eine neue …";
    editor.setAttribute("aria-label", "Markdown-Notiz");
    const suggestions = element("div", "nw-suggestions");
    suggestions.hidden = true;
    editorWrap.append(editor, dropHint, suggestions);

    const footer = element("div", "nw-footer");
    const statusText = element("span", "nw-status", "Lade Workspace …");
    const footerHint = element("span", "", "Markdown · [[Wiki-Links]] · Bilder per Drag & Drop");
    footer.append(statusText, footerHint);
    main.append(topbar, editorWrap, footer);
    shell.append(sidebar, main);
    overlay.append(shell);
    document.body.append(overlay);

    editor.addEventListener("input", () => {
      scheduleSave();
      renderSuggestions();
    });
    editor.addEventListener("click", () => {
      renderSuggestions();
      setTimeout(openWikiLinkAtCursor, 0);
    });
    editor.addEventListener("keyup", (event) => {
      if (["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) renderSuggestions();
    });
    editor.addEventListener("keydown", (event) => {
      const box = overlay.querySelector(".nw-suggestions");
      if (!box.hidden) {
        if (event.key === "Escape") {
          hideSuggestions();
          event.preventDefault();
          return;
        }
        if (suggestionItems.length && (event.key === "ArrowDown" || event.key === "ArrowUp")) {
          event.preventDefault();
          selectedSuggestion = (selectedSuggestion + (event.key === "ArrowDown" ? 1 : -1) + suggestionItems.length) % suggestionItems.length;
          Array.from(box.querySelectorAll(".nw-suggestion")).forEach((node, index) => {
            node.setAttribute("aria-selected", index === selectedSuggestion ? "true" : "false");
            if (index === selectedSuggestion) node.scrollIntoView({ block: "nearest" });
          });
          return;
        }
        if (suggestionItems.length && (event.key === "Enter" || event.key === "Tab")) {
          event.preventDefault();
          chooseSuggestion(suggestionItems[selectedSuggestion]);
          return;
        }
      }
      if (event.key === "Tab") {
        event.preventDefault();
        insertAtCursor("  ");
      }
    });
    editor.addEventListener("paste", (event) => {
      const files = Array.from(event.clipboardData?.files || []);
      if (files.some((file) => file.type.startsWith("image/"))) {
        event.preventDefault();
        uploadImages(files);
      }
    });

    editorWrap.addEventListener("dragover", (event) => {
      if (Array.from(event.dataTransfer?.items || []).some((item) => item.kind === "file")) {
        event.preventDefault();
        editorWrap.classList.add("nw-drag");
      }
    });
    editorWrap.addEventListener("dragleave", (event) => {
      if (!editorWrap.contains(event.relatedTarget)) editorWrap.classList.remove("nw-drag");
    });
    editorWrap.addEventListener("drop", (event) => {
      event.preventDefault();
      editorWrap.classList.remove("nw-drag");
      uploadImages(event.dataTransfer?.files || []);
    });

    window.addEventListener("beforeunload", beforeUnload);
    try {
      await loadTree();
      const home = treeItems.find((item) => item.type === "file" && item.path.toLowerCase() === "index.md");
      if (home) await openFile(home);
      else status("Workspace bereit – wähle links eine Notiz aus.", "success");
    } catch (error) {
      status(error.message, "error");
    }
  }

  window[STATE_KEY] = { open: openWorkspace };
  openWorkspace();
})();
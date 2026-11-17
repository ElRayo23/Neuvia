(() => {
  "use strict";

  const API = "https://neuvia-admin-api.forkleafcustom.workers.dev";
  const SESSION_KEY = "neuviaAdminSession";
  const DRAFT_PREFIX = "neuviaDraft:";
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

  function readDraft(path) {
    try {
      const raw = localStorage.getItem(DRAFT_PREFIX + path);
      return raw ? JSON.parse(raw) : null;
    } catch { return null; }
  }

  function storeDraft() {
    if (!currentPath || !overlay) return;
    try {
      localStorage.setItem(DRAFT_PREFIX + currentPath, JSON.stringify({
        content: getEditorContent(overlay.querySelector(".nw-editor")),
        sha: currentSha,
        savedAt: Date.now()
      }));
    } catch {}
  }

  function clearDraft(path) {
    try { localStorage.removeItem(DRAFT_PREFIX + path); } catch {}
  }

  let lastKnownEditorSelection = { start: 0, end: 0 };

  function markdownForEditorNode(node) {
    if (node.nodeType === Node.TEXT_NODE) return node.nodeValue || "";
    if (node.nodeType !== Node.ELEMENT_NODE) return "";
    if (node.classList.contains("nw-inline-image")) return node.dataset.markdown || "";
    if (node.tagName === "BR") return "\n";
    const content = Array.from(node.childNodes).map(markdownForEditorNode).join("");
    if (node.tagName === "DIV" || node.tagName === "P") {
      return content === "\n" ? "\n" : content + (content.endsWith("\n") ? "" : "\n");
    }
    return content;
  }

  function getEditorContent(editor) {
    return Array.from(editor.childNodes).map(markdownForEditorNode).join("");
  }

  function renderEditorContent(editor, markdown) {
    const source = String(markdown || "");
    const pattern = /!\[\[([^\]|]+)(?:\|([^\]]+))?\]\]|!\[([^\]]*)\]\(([^)]+)\)/g;
    const fragment = document.createDocumentFragment();
    let lastIndex = 0;
    let match;
    while ((match = pattern.exec(source))) {
      if (match.index > lastIndex) fragment.append(document.createTextNode(source.slice(lastIndex, match.index)));
      const path = (match[1] || match[4] || "").trim().replace(/^<|>$/g, "");
      const alt = match[2] || match[3] || "";
      const wrapper = element("span", "nw-inline-image");
      wrapper.contentEditable = "false";
      wrapper.dataset.markdown = match[0];
      wrapper.title = path;
      const image = document.createElement("img");
      image.src = imageUrl(path);
      image.alt = alt || basename(path);
      image.loading = "lazy";
      image.addEventListener("error", () => {
        const error = element("span", "nw-inline-image-error", "Bild konnte nicht geladen werden: " + basename(path));
        wrapper.replaceChildren(error);
      }, { once: true });
      wrapper.append(image);
      fragment.append(wrapper);
      lastIndex = pattern.lastIndex;
    }
    if (lastIndex < source.length) fragment.append(document.createTextNode(source.slice(lastIndex)));
    editor.replaceChildren(fragment);
  }

  function editorSelection(editor) {
    const selection = window.getSelection();
    const inside = (node) => node === editor || (node && editor.contains(node));
    if (!selection || !inside(selection.anchorNode) || !inside(selection.focusNode)) {
      const length = getEditorContent(editor).length;
      const start = Math.min(length, Math.max(0, lastKnownEditorSelection.start));
      const end = Math.min(length, Math.max(start, lastKnownEditorSelection.end));
      return { start, end };
    }
    const offsetOf = (target, offset) => {
      let total = 0;
      let found = false;
      const visit = (node) => {
        if (found) return;
        if (node === target) {
          if (node.nodeType === Node.TEXT_NODE) {
            total += Math.min(offset, node.nodeValue.length);
          } else {
            for (let i = 0; i < Math.min(offset, node.childNodes.length); i++) {
              total += markdownForEditorNode(node.childNodes[i]).length;
            }
          }
          found = true;
          return;
        }
        if (node.nodeType === Node.TEXT_NODE || (node.nodeType === Node.ELEMENT_NODE &&
            (node.classList.contains("nw-inline-image") || node.tagName === "BR"))) {
          total += markdownForEditorNode(node).length;
          return;
        }
        for (const child of node.childNodes || []) visit(child);
      };
      visit(editor);
      return found ? total : getEditorContent(editor).length;
    };
    const anchor = offsetOf(selection.anchorNode, selection.anchorOffset);
    const focus = offsetOf(selection.focusNode, selection.focusOffset);
    lastKnownEditorSelection = { start: Math.min(anchor, focus), end: Math.max(anchor, focus) };
    return lastKnownEditorSelection;
  }

  function setEditorCaret(editor, markdownOffset) {
    const target = Math.max(0, markdownOffset);
    let total = 0;
    let point = null;
    const find = (parent) => {
      const children = Array.from(parent.childNodes);
      for (let i = 0; i < children.length && !point; i++) {
        const child = children[i];
        if (child.nodeType === Node.TEXT_NODE) {
          const length = child.nodeValue.length;
          if (target <= total + length) {
            point = { node: child, offset: Math.max(0, Math.min(length, target - total)) };
            return;
          }
          total += length;
          continue;
        }
        if (child.nodeType === Node.ELEMENT_NODE && child.classList.contains("nw-inline-image")) {
          const length = (child.dataset.markdown || "").length;
          if (target <= total) { point = { node: parent, offset: i }; return; }
          if (target < total + length) {
            point = { node: parent, offset: i + (target - total >= length / 2 ? 1 : 0) };
            return;
          }
          total += length;
          continue;
        }
        if (child.nodeType === Node.ELEMENT_NODE && child.tagName === "BR") {
          if (target <= total + 1) { point = { node: parent, offset: i + (target > total ? 1 : 0) }; return; }
          total += 1;
          continue;
        }
        if (child.nodeType === Node.ELEMENT_NODE) {
          find(child);
          if (!point) {
            const length = markdownForEditorNode(child).length;
            if (target <= total + length) { point = { node: parent, offset: i + 1 }; return; }
            total += length;
          }
        }
      }
    };
    find(editor);
    if (!point) point = { node: editor, offset: editor.childNodes.length };
    const range = document.createRange();
    range.setStart(point.node, point.offset);
    range.collapse(true);
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
    lastKnownEditorSelection = { start: target, end: target };
  }

  function replaceEditorRange(editor, start, end, replacement) {
    const value = getEditorContent(editor);
    const next = value.slice(0, start) + replacement + value.slice(end);
    const cursor = start + replacement.length;
    renderEditorContent(editor, next);
    setEditorCaret(editor, cursor);
    editor.dispatchEvent(new Event("input", { bubbles: true }));
    return cursor;
  }

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
    "#neuvia-workspace .nw-current-group{display:flex;align-items:center;gap:9px;min-width:0;overflow:hidden;}",
    "#neuvia-workspace .nw-back{flex-shrink:0;border:1px solid var(--lightgray,#ddd);border-radius:7px;padding:6px 9px;background:var(--light,#fff);color:inherit;}",
    "#neuvia-workspace .nw-back:disabled{opacity:.35;cursor:default;}",
    "#neuvia-workspace .nw-current{min-width:0;overflow:hidden;}",
    "#neuvia-workspace .nw-current-title{font-size:14px;font-weight:700;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}",
    "#neuvia-workspace .nw-current-path{font-size:11px;opacity:.58;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}",
    "#neuvia-workspace .nw-top-actions{display:flex;align-items:center;gap:7px;flex-shrink:0;}",
    "#neuvia-workspace .nw-editor-wrap{position:relative;display:flex;flex:1;min-height:0;}",
    "#neuvia-workspace .nw-editor{display:block;width:100%;height:100%;min-height:0;resize:none;border:0;outline:0;padding:30px clamp(18px,5vw,64px) 48px;background:var(--light,#faf8f8);color:var(--dark,#2b2b2b);font:14px/1.72 ui-monospace,SFMono-Regular,Consolas,monospace;tab-size:2;white-space:pre-wrap;overflow-wrap:anywhere;overflow:auto;}",
    "#neuvia-workspace .nw-editor:empty::before{content:attr(data-placeholder);color:var(--gray,#999);pointer-events:none;}",
    "#neuvia-workspace .nw-editor .nw-inline-image{display:inline-block;max-width:100%;margin:8px 0;vertical-align:top;}",
    "#neuvia-workspace .nw-editor .nw-inline-image img{display:block;max-width:min(100%,720px);max-height:360px;width:auto;height:auto;object-fit:contain;border-radius:6px;}",
    "#neuvia-workspace .nw-editor .nw-inline-image-error{display:inline-block;padding:6px 9px;border:1px solid #c66;border-radius:5px;color:#c33;font:12px system-ui,sans-serif;}",
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
    "#neuvia-workspace .nw-image-backdrop{position:fixed;inset:0;z-index:30;display:flex;align-items:center;justify-content:center;padding:18px;background:#000b;}",
    "#neuvia-workspace .nw-image-preview{display:flex;flex-direction:column;gap:10px;max-width:min(1100px,96vw);max-height:94vh;padding:12px;border:1px solid var(--lightgray,#bbb);border-radius:10px;background:var(--light,#faf8f8);box-shadow:0 12px 40px #0008;}",
    "#neuvia-workspace .nw-image-preview-header{display:flex;align-items:center;justify-content:space-between;gap:14px;}",
    "#neuvia-workspace .nw-image-preview-path{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:12px;opacity:.7;}",
    "#neuvia-workspace .nw-image-preview img{display:block;max-width:calc(96vw - 48px);max-height:calc(94vh - 75px);width:auto;height:auto;object-fit:contain;}",
    "#neuvia-workspace .nw-image-preview-error{margin:8px;color:#c33;font-size:13px;}",
    "#neuvia-workspace .nw-context-menu{position:fixed;z-index:50;min-width:210px;padding:5px;border:1px solid var(--lightgray,#bbb);border-radius:9px;background:var(--light,#fff);box-shadow:0 8px 28px #0004;}",
    "#neuvia-workspace .nw-context-menu button{display:block;width:100%;padding:8px 10px;border:0;border-radius:5px;background:transparent;color:inherit;text-align:left;}",
    "#neuvia-workspace .nw-context-menu button:hover{background:var(--highlight,rgba(120,130,140,.18));}",
    "#neuvia-workspace .nw-context-menu .nw-danger{color:#c33;}",
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
  const navigationHistory = [];
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
    return !!(editor && currentPath && getEditorContent(editor) !== savedContent);
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
      if (getEditorContent(editor) !== savedContent) return saveCurrent();
      return true;
    }
    const snapshot = getEditorContent(editor);
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
        if (getEditorContent(editor) === snapshot) {
          clearDraft(path);
          status(data.unchanged
            ? "Bereits synchronisiert – keine Änderungen."
            : "Sync abgeschlossen · GitHub-Commit " + String(data.commit || "").slice(0, 7), "success");
        } else {
          storeDraft();
          scheduleSave();
        }
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
        bindContextActions(row, item.path, false);
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
      row.title = item.path + " · Rechtsklick zum Verschieben/Umbenennen";
      row.addEventListener("click", () => openFile(item));
      bindContextActions(row, item.path, false);
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
      row.title = folder.path + " · Rechtsklick zum Verschieben/Umbenennen";
      row.addEventListener("click", () => {
        children.hidden = !children.hidden;
        arrow.textContent = children.hidden ? "▸" : "▾";
        activeFolder = folder.path;
      });
      bindContextActions(row, folder.path, true);
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


  function closeContextMenu() {
    overlay?.querySelector(".nw-context-menu")?.remove();
  }

  function showContextMenu(path, isFolder, x, y) {
    closeContextMenu();
    activeFolder = isFolder ? path : path.split("/").slice(0, -1).join("/");
    const menu = element("div", "nw-context-menu");
    menu.style.left = Math.max(8, Math.min(x, window.innerWidth - 225)) + "px";
    menu.style.top = Math.max(8, Math.min(y, window.innerHeight - 230)) + "px";
    menu.setAttribute("role", "menu");
    const action = (label, callback, danger = false) => {
      const button = element("button", danger ? "nw-danger" : "", label);
      button.type = "button";
      button.addEventListener("click", async () => { closeContextMenu(); await callback(); });
      menu.append(button);
    };
    action("Umbenennen", () => showRenameDialog(path, isFolder));
    action("Verschieben", () => showFolderPicker(path, isFolder));
    if (isFolder) action("Ordner löschen (Inhalt behalten)", () => deletePath(path, "contents"));
    action("Löschen", () => deletePath(path, isFolder ? "recursive" : "file"), true);
    action("Neuen Beitrag erstellen", () => showDialog("note"));
    overlay.append(menu);
    const dismiss = (event) => {
      if (!menu.contains(event.target)) { closeContextMenu(); document.removeEventListener("pointerdown", dismiss, true); }
    };
    setTimeout(() => document.addEventListener("pointerdown", dismiss, true), 0);
  }

  function bindContextActions(row, path, isFolder) {
    row.addEventListener("contextmenu", (event) => {
      event.preventDefault();
      showContextMenu(path, isFolder, event.clientX, event.clientY);
    });
    let pressTimer = null;
    let longPressed = false;
    row.addEventListener("pointerdown", (event) => {
      if (event.pointerType !== "touch") return;
      longPressed = false;
      pressTimer = setTimeout(() => {
        longPressed = true;
        showContextMenu(path, isFolder, event.clientX || 20, event.clientY || 80);
      }, 550);
    });
    const cancelPress = () => { if (pressTimer) clearTimeout(pressTimer); pressTimer = null; };
    row.addEventListener("pointerup", cancelPress);
    row.addEventListener("pointerleave", cancelPress);
    row.addEventListener("pointercancel", cancelPress);
    row.addEventListener("click", (event) => {
      if (longPressed) { event.preventDefault(); event.stopImmediatePropagation(); longPressed = false; }
    }, true);
  }

  function showRenameDialog(source, isFolder) {
    const backdrop = element("div", "nw-dialog-backdrop");
    const dialog = element("form", "nw-dialog");
    dialog.append(element("h2", "", "Umbenennen"));
    dialog.append(element("div", "nw-muted", source));
    dialog.append(element("label", "", "Neuer Name"));
    const input = element("input");
    const oldName = basename(source);
    input.value = isFolder ? oldName : oldName.replace(/\.[^.]+$/, "");
    input.required = true;
    dialog.append(input);
    const error = element("div", "nw-error");
    const actions = element("div", "nw-dialog-actions");
    const cancel = element("button", "nw-button", "Abbrechen");
    cancel.type = "button";
    const submit = element("button", "nw-button nw-primary", "Umbenennen");
    submit.type = "submit";
    actions.append(cancel, submit);
    dialog.append(error, actions);
    backdrop.append(dialog); overlay.append(backdrop);
    cancel.addEventListener("click", () => backdrop.remove());
    backdrop.addEventListener("click", (event) => { if (event.target === backdrop) backdrop.remove(); });
    dialog.addEventListener("submit", async (event) => {
      event.preventDefault();
      const name = input.value.trim();
      if (!name || /[\\/]/.test(name) || name === "." || name === "..") { error.textContent = "Bitte einen gültigen Namen ohne Pfadtrenner eingeben."; return; }
      const nextName = isFolder || /\.[^.]+$/.test(name) ? name : name + (oldName.match(/\.[^.]+$/)?.[0] || "");
      const destination = [source.split("/").slice(0,-1).join("/"), nextName].filter(Boolean).join("/");
      if (destination === source) { backdrop.remove(); return; }
      submit.disabled = true;
      try {
        await saveCurrent();
        const result = await request("/api/move", { method:"POST", body:JSON.stringify({source,destination}) });
        const currentMoves = currentPath === source || (isFolder && currentPath.startsWith(source + "/"));
        const nextCurrent = currentMoves ? destination + currentPath.slice(source.length) : "";
        backdrop.remove();
        if (currentMoves) { clearDraft(currentPath); currentPath = ""; currentSha = ""; savedContent = ""; updateCurrentHeader(); }
        await loadTree();
        if (nextCurrent) await openFile({path:nextCurrent,type:"file",name:basename(nextCurrent)});
        status("Umbenannt · " + (result.rewrittenNotes || 0) + " Wiki-Link(s) aktualisiert", "success");
      } catch (err) { error.textContent = err.message; submit.disabled = false; }
    });
    input.focus(); input.select();
  }

  function showFolderPicker(source, isFolder) {
    const backdrop = element("div", "nw-dialog-backdrop");
    const dialog = element("form", "nw-dialog");
    dialog.append(element("h2", "", "Zielordner auswählen"));
    dialog.append(element("div", "nw-muted", "Quelle: " + source));
    dialog.append(element("label", "", "Zielordner"));
    const select = element("select");
    select.style.cssText = "width:100%;padding:9px;border:1px solid var(--lightgray,#aaa);border-radius:7px;background:var(--light,#fff);color:inherit;";
    const addOption = (value,label) => { const option=element("option","",label); option.value=value; select.append(option); };
    addOption("", "Vault-Hauptordner");
    for (const item of treeItems.filter((entry) => entry.type === "folder").sort((a,b)=>a.path.localeCompare(b.path,"de"))) {
      if (item.path === source || (isFolder && item.path.startsWith(source + "/"))) continue;
      addOption(item.path, item.path);
    }
    const error = element("div", "nw-error");
    const actions = element("div", "nw-dialog-actions");
    const cancel = element("button", "nw-button", "Abbrechen"); cancel.type="button";
    const submit = element("button", "nw-button nw-primary", "Verschieben"); submit.type="submit";
    actions.append(cancel,submit); dialog.append(select,error,actions); backdrop.append(dialog); overlay.append(backdrop);
    cancel.addEventListener("click",()=>backdrop.remove());
    backdrop.addEventListener("click",(event)=>{if(event.target===backdrop)backdrop.remove();});
    dialog.addEventListener("submit",async(event)=>{
      event.preventDefault();
      const destination=[select.value,basename(source)].filter(Boolean).join("/");
      if(destination===source){error.textContent="Bitte einen anderen Zielordner wählen.";return;}
      submit.disabled=true; cancel.disabled=true;
      const oldPath=currentPath;
      const moves=oldPath===source || (isFolder && oldPath.startsWith(source+"/"));
      const nextPath=moves?destination+oldPath.slice(source.length):"";
      try{
        await saveCurrent();
        const result=await request("/api/move",{method:"POST",body:JSON.stringify({source,destination})});
        backdrop.remove();
        if(moves){clearDraft(oldPath);currentPath="";currentSha="";savedContent="";updateCurrentHeader();}
        activeFolder=select.value;
        await loadTree();
        if(nextPath)await openFile({path:nextPath,type:"file",name:basename(nextPath)});
        status("Verschoben · "+(result.rewrittenNotes||0)+" Wiki-Link(s) aktualisiert","success");
      }catch(err){error.textContent=err.message;submit.disabled=false;cancel.disabled=false;}
    });
  }

  async function deletePath(path, mode) {
    const description = mode === "recursive" ? "Der Ordner und ALLE enthaltenen Dateien und Unterordner werden endgültig gelöscht." :
      mode === "contents" ? "Alle Inhalte werden eine Ebene nach oben verschoben. Der Ordner wird entfernt." :
      "Der Beitrag wird endgültig gelöscht.";
    if (!window.confirm(description + "\n\n" + path + "\n\nFortfahren?")) return;
    try {
      await saveCurrent();
      const result = await request("/api/delete", {method:"POST",body:JSON.stringify({path,mode})});
      let nextPath = "";
      if (mode === "contents" && currentPath.startsWith(path + "/")) {
        const parent = path.includes("/") ? path.slice(0,path.lastIndexOf("/")) : "";
        nextPath = [parent,currentPath.slice(path.length+1)].filter(Boolean).join("/");
      }
      const currentRemoved = mode === "file" ? currentPath === path : mode === "recursive" ? currentPath === path || currentPath.startsWith(path+"/") : false;
      if (currentRemoved || nextPath) {
        clearDraft(currentPath); currentPath=""; currentSha=""; savedContent=""; updateCurrentHeader();
      }
      await loadTree();
      if (nextPath) await openFile({path:nextPath,type:"file",name:basename(nextPath)});
      status(mode === "contents" ? "Ordner entfernt; Inhalte eine Ebene nach oben verschoben." : "Gelöscht · "+result.changedFiles+" Datei(en).","success");
    } catch(error) { status(error.message,"error"); alert(error.message); }
  }

  const IMAGE_TYPES = new Set(["png", "jpg", "jpeg", "webp", "gif", "avif", "svg"]);

  function imageUrl(path) {
    const value = String(path || "").trim();
    if (/^(https?:|data:|blob:)/i.test(value)) return value;
    return API + "/api/public-asset?path=" + encodeURIComponent(value.replace(/^\/+/, ""));
  }

  function showImagePreview(path, alt = "") {
    const backdrop = element("div", "nw-image-backdrop");
    backdrop.setAttribute("role", "dialog");
    backdrop.setAttribute("aria-modal", "true");
    backdrop.setAttribute("aria-label", "Bildvorschau");
    const panel = element("div", "nw-image-preview");
    const header = element("div", "nw-image-preview-header");
    const label = element("div", "nw-image-preview-path", path);
    const close = element("button", "nw-button", "Schließen");
    close.type = "button";
    close.addEventListener("click", () => backdrop.remove());
    header.append(label, close);
    const image = document.createElement("img");
    image.src = imageUrl(path);
    image.alt = alt || basename(path);
    image.addEventListener("error", () => {
      const error = element("p", "nw-image-preview-error", "Bild konnte nicht geladen werden. Prüfe den Pfad und ob die Datei veröffentlicht bzw. hochgeladen wurde.");
      panel.append(error);
    }, { once: true });
    panel.append(header, image);
    backdrop.append(panel);
    backdrop.addEventListener("click", (event) => { if (event.target === backdrop) backdrop.remove(); });
    const onKey = (event) => {
      if (event.key === "Escape" && backdrop.isConnected) {
        backdrop.remove();
        document.removeEventListener("keydown", onKey);
      }
    };
    document.addEventListener("keydown", onKey);
    backdrop.addEventListener("DOMNodeRemoved", () => document.removeEventListener("keydown", onKey), { once: true });
    overlay.append(backdrop);
  }

  function imageReferenceAtCursor() {
    const editor = overlay && overlay.querySelector(".nw-editor");
    if (!editor) return null;
    const cursor = editorSelection(editor).start;
    const value = getEditorContent(editor);
    const lineStart = value.lastIndexOf("\n", cursor - 1) + 1;
    const lineEndRaw = value.indexOf("\n", cursor);
    const line = value.slice(lineStart, lineEndRaw < 0 ? value.length : lineEndRaw);
    const local = cursor - lineStart;
    const patterns = [
      /!\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g,
      /!\[[^\]]*\]\(([^)]+)\)/g
    ];
    for (const pattern of patterns) {
      let match;
      while ((match = pattern.exec(line))) {
        if (local >= match.index && local <= match.index + match[0].length) {
          return { path: match[1].trim().replace(/^<|>$/g, ""), alt: match[2] || "" };
        }
      }
    }
    return null;
  }

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
    const moveButton = overlay.querySelector(".nw-move-current");
    const backButton = overlay.querySelector(".nw-back");
    if (moveButton) moveButton.disabled = !currentPath;
    if (backButton) backButton.disabled = navigationHistory.length === 0;
    if (!currentPath) {
      title.textContent = "Keine Notiz geöffnet";
      path.textContent = "Wähle links eine Markdown-Datei aus";
      return;
    }
    title.textContent = getLinkIndexTitle(currentPath);
    path.textContent = currentPath;
  }

  async function openFile(item, options = {}) {
    if (item.type !== "file") return;
    const ext = extension(item.path);
    if (IMAGE_TYPES.has(ext)) {
      showImagePreview(item.path);
      return;
    }
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
      const previousPath = currentPath;
      if (!options.fromHistory && previousPath) navigationHistory.push(previousPath);
      currentPath = item.path;
      activeFolder = item.path.split("/").slice(0, -1).join("/");
      currentSha = data.sha || "";
      savedContent = data.content || "";
      const editor = overlay.querySelector(".nw-editor");
      renderEditorContent(editor, savedContent);
      editor.contentEditable = "true";
      editor.setAttribute("aria-disabled", "false");
      lastKnownEditorSelection = { start: 0, end: 0 };
      setEditorCaret(editor, 0);
      hideSuggestions();
      const draft = readDraft(item.path);
      if (draft && typeof draft.content === "string" && draft.content !== savedContent) {
        const sameVersion = !!draft.sha && draft.sha === data.sha;
        const question = sameVersion
          ? "Für diese Notiz gibt es einen lokalen, noch nicht synchronisierten Entwurf. Möchtest du ihn wiederherstellen?"
          : "Es gibt einen lokalen Entwurf, aber die GitHub-Datei wurde seitdem verändert. Entwurf trotzdem wiederherstellen? Der Sync wird dann zunächst wegen eines Versionskonflikts blockiert.";
        if (window.confirm(question)) {
          renderEditorContent(editor, draft.content);
          if (!sameVersion) currentSha = draft.sha || "__local_draft_without_base_sha__";
          status(sameVersion ? "Lokaler Entwurf wiederhergestellt" : "Älterer lokaler Entwurf wiederhergestellt – Versionskonflikt beachten", sameVersion ? "success" : "error");
          scheduleSave();
        } else {
          clearDraft(item.path);
        }
      } else if (draft) {
        clearDraft(item.path);
      }
      editor.focus();
      updateCurrentHeader();
      renderTree();
      if (!currentIsDirty()) status("Synchronisiert", "success");
    } catch (error) {
      status(error.message, "error");
    }
  }

  async function goBack() {
    if (!navigationHistory.length) return;
    const previousPath = navigationHistory.pop();
    const item = treeItems.find((entry) => entry.type === "file" && entry.path === previousPath);
    if (!item) {
      updateCurrentHeader();
      status("Die vorherige Notiz existiert nicht mehr: " + previousPath, "error");
      return;
    }
    await openFile(item, { fromHistory: true });
  }

  function resolveWikiTarget(rawTarget) {
    const target = String(rawTarget || "").split("|")[0].split("#")[0].trim();
    if (!target) return null;
    const q = normalize(target.replace(/\.md$/i, "").replace(/\/+$/, ""));
    const mdFiles = treeItems.filter((item) => item.type === "file" && extension(item.path) === "md");
    const candidates = [];
    const existingMarkdownPaths = new Set(mdFiles.map((item) => item.path));
    for (const item of linkItems) {
      if (!existingMarkdownPaths.has(item.path)) continue;
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
    const cursor = editorSelection(editor).start;
    const value = getEditorContent(editor);
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
    const selection = editorSelection(editor);
    const cursor = selection.start;
    if (selection.end !== cursor) return null;
    const before = getEditorContent(editor).slice(0, cursor);
    const start = before.lastIndexOf("[[");
    if (start < 0 || before.slice(start + 2).includes("]]") || before.slice(start + 2).includes("\n")) return null;
    const rawQuery = before.slice(start + 2);
    const aliasSeparator = rawQuery.indexOf("|");
    return {
      start,
      end: cursor,
      query: aliasSeparator < 0 ? rawQuery : rawQuery.slice(0, aliasSeparator),
      alias: aliasSeparator < 0 ? "" : rawQuery.slice(aliasSeparator)
    };
  }

  function buildLinkCandidates(query) {
    const q = normalize(query);
    const entries = [];
    const seen = new Set();
    const currentMarkdownPaths = new Set(treeItems.filter((entry) => entry.type === "file" && extension(entry.path) === "md").map((entry) => entry.path));
    for (const item of linkItems) {
      if (!item.path || !currentMarkdownPaths.has(item.path)) continue;
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
        let linkTarget = item.path.replace(/\.md$/i, "");
        if (/\/index$/i.test(linkTarget)) linkTarget = linkTarget.slice(0, -6);
        else if (linkTarget.toLowerCase() === "index") linkTarget = "";
        entries.push({ title, target: linkTarget, path: item.path, score: normalize(title).startsWith(q) ? 0 : 1 });
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
    const insertion = "[[" + item.target + (active.alias || "") + "]]";
    replaceEditorRange(editor, active.start, active.end, insertion);
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
    const selection = editorSelection(editor);
    replaceEditorRange(editor, selection.start, selection.end, text);
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
    let uploaded = 0;
    try {
      for (const file of images) {
        status("Lade Bild hoch: " + file.name);
        const form = new FormData();
        form.append("file", file, file.name);
        const result = await request("/api/upload", { method: "POST", body: form });
        treeItems.push({
          name: basename(result.path),
          path: result.path,
          type: "file",
          extension: extension(result.path),
          size: result.size || file.size,
        });
        uploaded++;
        renderTree();
        insertAtCursor(result.embed + "\n");
      }
      status(images.length + (images.length === 1 ? " Bild hochgeladen" : " Bilder hochgeladen") + " – synchronisiere Notiz …", "success");
      await saveCurrent();
    } catch (error) {
      if (uploaded && currentIsDirty()) {
        try { await saveCurrent(); } catch {}
      }
      status(error.message + (uploaded ? " Bereits hochgeladene Bilder wurden eingefügt." : ""), "error");
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
        const folderTitle = folderName.split("/").pop().replace(/[\r\n]/g, " ").trim();
        content = "---\ntitle: " + JSON.stringify(folderTitle) + "\n---\n\n# " + folderTitle + "\n";
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

  function showMoveDialog(source, isFolder) {
    const backdrop = element("div", "nw-dialog-backdrop");
    const dialog = element("form", "nw-dialog");
    dialog.append(element("h2", "", isFolder ? "Ordner verschieben oder umbenennen" : "Datei verschieben oder umbenennen"));
    dialog.append(element("div", "nw-muted", "Quellpfad: " + source));
    dialog.append(element("label", "", "Neuer Pfad (relativ zum Vault)"));
    const destinationInput = element("input");
    destinationInput.required = true;
    destinationInput.value = source;
    destinationInput.placeholder = isFolder ? "z. B. Kampagnen/Neue Gruppe" : "z. B. Lore/Neuer Name.md";
    dialog.append(destinationInput);
    const help = element("div", "nw-muted", isFolder
      ? "Der gesamte Ordner einschließlich aller Unterordner und Dateien wird gemeinsam verschoben."
      : "Die Dateiendung bleibt erhalten. Das Verschieben wird als ein einzelner GitHub-Commit ausgeführt.");
    help.style.marginTop = "7px";
    dialog.append(help);
    const error = element("div", "nw-error");
    const actions = element("div", "nw-dialog-actions");
    const cancel = element("button", "nw-button", "Abbrechen");
    cancel.type = "button";
    const submit = element("button", "nw-button nw-primary", "Verschieben");
    submit.type = "submit";
    actions.append(cancel, submit);
    dialog.append(error, actions);
    backdrop.append(dialog);
    overlay.append(backdrop);
    cancel.addEventListener("click", () => backdrop.remove());
    backdrop.addEventListener("click", (event) => { if (event.target === backdrop) backdrop.remove(); });

    dialog.addEventListener("submit", async (event) => {
      event.preventDefault();
      const destination = destinationInput.value.trim().replace(/^\/+|\/+$/g, "");
      if (!destination || destination === source) {
        error.textContent = "Bitte einen neuen, vom Quellpfad abweichenden Zielpfad angeben.";
        return;
      }
      submit.disabled = true;
      cancel.disabled = true;
      error.textContent = "";
      const oldCurrentPath = currentPath;
      const currentMoves = !!oldCurrentPath && (oldCurrentPath === source || (isFolder && oldCurrentPath.startsWith(source + "/")));
      const newCurrentPath = currentMoves ? destination + oldCurrentPath.slice(source.length) : "";
      try {
        await saveCurrent();
        status(isFolder ? "Verschiebe Ordner …" : "Verschiebe Datei …");
        const moveResult = await request("/api/move", {
          method: "POST",
          body: JSON.stringify({ source, destination })
        });
        backdrop.remove();
        if (currentMoves) {
          clearDraft(oldCurrentPath);
          currentPath = "";
          currentSha = "";
          savedContent = "";
          updateCurrentHeader();
        }
        activeFolder = isFolder ? destination : destination.split("/").slice(0, -1).join("/");
        await loadTree();
        if (currentMoves && newCurrentPath) {
          await openFile({ path: newCurrentPath, type: "file", name: basename(newCurrentPath) });
        }
        status((isFolder ? "Ordner" : "Datei") + " verschoben · " + (moveResult.rewrittenNotes || 0) + " Notizen mit angepassten Wiki-Links · in GitHub gesichert", "success");
      } catch (err) {
        error.textContent = err.message;
        submit.disabled = false;
        cancel.disabled = false;
        status(err.message, "error");
      }
    });
    destinationInput.focus();
    destinationInput.select();
  }

  function checkPublication(commit, attempt = 0) {
    if (!overlay || attempt >= 100) {
      if (overlay && attempt >= 100) status("Veröffentlichung läuft weiter. Der Status kann später erneut geprüft werden.", "normal");
      return;
    }
    setTimeout(async () => {
      if (!overlay) return;
      try {
        const result = await request("/api/publish-status?commit=" + encodeURIComponent(commit));
        if (result.status === "completed") {
          if (result.conclusion === "success") {
            status("Veröffentlichung erfolgreich abgeschlossen.", "success");
          } else {
            status("Veröffentlichung fehlgeschlagen (" + String(result.conclusion || "unbekannt") + "). GitHub Actions prüfen.", "error");
          }
          return;
        }
        if (result.status === "in_progress") status("Website-Build läuft im Hintergrund …");
        else status("Veröffentlichung wartet auf den Build …");
      } catch (error) {
        status("Veröffentlichung gestartet; Statusabfrage fehlgeschlagen: " + error.message, "error");
      }
      checkPublication(commit, attempt + 1);
    }, 6000);
  }

  async function publish() {
    const button = overlay.querySelector(".nw-publish");
    button.disabled = true;
    try {
      await saveCurrent();
      status("Starte Veröffentlichung …");
      const result = await request("/api/publish", { method: "POST", body: "{}" });
      if (!result.commit) throw new Error("GitHub hat keinen Veröffentlichungs-Commit zurückgegeben.");
      status("Veröffentlichung angestoßen. Du kannst weiterarbeiten; der Status wird im Hintergrund geprüft.", "success");
      checkPublication(result.commit);
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
    const currentGroup = element("div", "nw-current-group");
    const backButton = element("button", "nw-back", "← Zurück");
    backButton.type = "button";
    backButton.disabled = true;
    backButton.title = "Zur vorherigen Notiz (Alt + ←)";
    backButton.addEventListener("click", goBack);
    const current = element("div", "nw-current");
    const currentTitle = element("div", "nw-current-title", "Keine Notiz geöffnet");
    const currentPathLabel = element("div", "nw-current-path", "Wähle links eine Markdown-Datei aus");
    current.append(currentTitle, currentPathLabel);
    currentGroup.append(backButton, current);
    const topActions = element("div", "nw-top-actions");
    const imagePicker = element("input");
    imagePicker.type = "file";
    imagePicker.accept = "image/png,image/jpeg,image/webp,image/gif,image/avif";
    imagePicker.multiple = true;
    imagePicker.hidden = true;
    imagePicker.addEventListener("change", () => {
      uploadImages(imagePicker.files);
      imagePicker.value = "";
    });
    const imageButton = element("button", "nw-button", "Bild hinzufügen");
    imageButton.type = "button";
    imageButton.addEventListener("click", () => imagePicker.click());
    const imagePreviewButton = element("button", "nw-button nw-image-preview-current", "Bildvorschau");
    imagePreviewButton.type = "button";
    imagePreviewButton.addEventListener("click", () => {
      const reference = imageReferenceAtCursor();
      if (reference) showImagePreview(reference.path, reference.alt);
      else status("Setze den Cursor in einen Bildverweis wie ![[Files/Bild.png]] oder ![Alt](Files/Bild.png).", "normal");
    });
    const moveButton = element("button", "nw-button nw-move-current", "Verschieben");
    moveButton.type = "button";
    moveButton.disabled = true;
    moveButton.addEventListener("click", () => {
      if (currentPath) showMoveDialog(currentPath, false);
    });
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
    topActions.append(imageButton, imagePreviewButton, moveButton, sync, publishButton, website);
    topbar.append(currentGroup, topActions);

    const editorWrap = element("div", "nw-editor-wrap");
    const dropHint = element("div", "nw-drop-hint", "Bild hier ablegen – Einfügen an der Cursorposition");
    const editor = element("div", "nw-editor");
    editor.contentEditable = "false";
    editor.spellcheck = false;
    editor.setAttribute("role", "textbox");
    editor.setAttribute("aria-multiline", "true");
    editor.setAttribute("aria-label", "Markdown-Notiz");
    editor.setAttribute("aria-disabled", "true");
    editor.dataset.placeholder = "Wähle links eine Notiz aus oder erstelle eine neue …";
    editor.dataset.placeholder = "Wähle links eine Notiz aus oder erstelle eine neue …";
    const suggestions = element("div", "nw-suggestions");
    suggestions.hidden = true;
    editorWrap.append(editor, dropHint, suggestions);
    editorWrap.append(imagePicker);

    const footer = element("div", "nw-footer");
    const statusText = element("span", "nw-status", "Lade Workspace …");
    const footerHint = element("span", "", "Markdown · [[Notiz|Anzeigetext]] · Bilder per Drag & Drop");
    footer.append(statusText, footerHint);
    main.append(topbar, editorWrap, footer);
    shell.append(sidebar, main);
    overlay.append(shell);
    document.body.append(overlay);

    editor.addEventListener("input", () => {
      editorSelection(editor);
      storeDraft();
      scheduleSave();
      renderSuggestions();
    });
    editor.addEventListener("click", () => {
      editorSelection(editor);
      renderSuggestions();
      setTimeout(() => {
        const reference = imageReferenceAtCursor();
        if (reference) showImagePreview(reference.path, reference.alt);
        else openWikiLinkAtCursor();
      }, 0);
    });
    editor.addEventListener("keyup", (event) => {
      editorSelection(editor);
      if (["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) renderSuggestions();
    });
    editor.addEventListener("keydown", (event) => {
      if (event.altKey && event.key === "ArrowLeft") {
        event.preventDefault();
        goBack();
        return;
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") {
        event.preventDefault();
        overlay.querySelector(".nw-sync").click();
        return;
      }
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
      if (event.key === "Enter" && !event.isComposing) {
        event.preventDefault();
        insertAtCursor("\n");
        return;
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
      if (Array.from(event.dataTransfer?.items || []).some((item) => item.kind === "file" && item.type.startsWith("image/"))) {
        event.preventDefault();
        editorWrap.classList.add("nw-drag");
      }
    });
    editorWrap.addEventListener("dragleave", (event) => {
      if (!editorWrap.contains(event.relatedTarget)) editorWrap.classList.remove("nw-drag");
    });
    editorWrap.addEventListener("drop", (event) => {
      editorWrap.classList.remove("nw-drag");
      const files = Array.from(event.dataTransfer?.files || []);
      if (!files.some((file) => file.type.startsWith("image/"))) return;
      event.preventDefault();
      uploadImages(files);
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
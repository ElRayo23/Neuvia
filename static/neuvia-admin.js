(() => {
  const API = "https://neuvia-admin-api.forkleafcustom.workers.dev";
  const KEY = "neuviaAdminSession";
  const adminScript = document.querySelector('script[src*="neuvia-admin.js"]');
  const MAP_URL = adminScript ? new URL("neuvia-content-map.json", adminScript.src).toString() : "/static/neuvia-content-map.json";
  const LINK_URL = adminScript ? new URL("neuvia-link-index.json", adminScript.src).toString() : "/static/neuvia-link-index.json";
  const token = () => sessionStorage.getItem(KEY) || "";
  const request = async (path, options={}) => {
    const headers = {...(options.body ? {"Content-Type":"text/plain;charset=UTF-8"} : {}), ...(options.headers||{})};
    if (token()) headers.Authorization = "Bearer " + token();
    const res = await fetch(API + path, {...options, headers});
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || "Anfrage fehlgeschlagen.");
    return data;
  };
  const style = document.createElement("style");
  style.textContent = `
    #neuvia-admin-button{position:fixed;right:18px;top:16px;z-index:99999;border:0;border-radius:8px;padding:9px 14px;background:var(--secondary,#284b63);color:white;font:600 14px sans-serif;cursor:pointer;box-shadow:0 2px 10px #0003}
    #neuvia-admin-overlay{position:fixed;inset:0;z-index:100000;background:#0009;display:flex;align-items:center;justify-content:center;padding:14px}
    #neuvia-admin-dialog{box-sizing:border-box;position:relative;width:min(760px,100%);max-height:92vh;overflow:auto;background:var(--light,#faf8f8);color:var(--dark,#2b2b2b);border:1px solid var(--lightgray,#ddd);border-radius:12px;padding:20px;font:14px sans-serif;box-shadow:0 12px 40px #0005}
    #neuvia-admin-dialog h2{margin:0 0 12px;font-size:20px}
    #neuvia-admin-dialog textarea{box-sizing:border-box;width:100%;min-height:55vh;resize:vertical;padding:12px;border:1px solid #999;border-radius:7px;background:var(--light,#fff);color:inherit;font:13px/1.5 ui-monospace,monospace}
    #neuvia-link-suggestions{position:fixed;z-index:100003;width:min(460px,calc(100vw - 28px));max-height:235px;overflow:auto;padding:5px;border:1px solid var(--gray,#999);border-radius:8px;background:var(--light,#fff);color:var(--dark,#222);box-shadow:0 8px 28px #0004}
    #neuvia-link-suggestions[hidden]{display:none!important}
    #neuvia-link-suggestions button{display:flex;align-items:center;justify-content:space-between;gap:12px;width:100%;margin:0;padding:8px 9px;border:0;border-radius:5px;background:transparent;color:inherit;text-align:left}
    #neuvia-link-suggestions button[aria-selected="true"],#neuvia-link-suggestions button:hover{background:var(--highlight,#ddd)}
    #neuvia-link-suggestions .neuvia-link-title{font-weight:650;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
    #neuvia-link-suggestions .neuvia-link-path{font-size:11px;opacity:.7;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
    #neuvia-link-suggestions .neuvia-link-empty{padding:9px;color:var(--darkgray,#666);font-size:12px}
    #neuvia-admin-dialog input{box-sizing:border-box;width:100%;padding:10px;border:1px solid #999;border-radius:7px;margin:6px 0 12px;background:transparent;color:inherit}
    #neuvia-admin-dialog button{padding:9px 13px;border:0;border-radius:7px;cursor:pointer;margin:10px 6px 0 0}
    #neuvia-admin-submit{background:var(--secondary,#284b63);color:white}
    #neuvia-admin-error{color:#c33;min-height:20px;margin:8px 0}
  `;
  document.head.appendChild(style);
  const button=document.createElement("button");button.id="neuvia-admin-button";button.type="button";button.textContent="Anmelden";document.body.appendChild(button);
  function showMessage(message){const overlay=document.createElement("div");overlay.id="neuvia-admin-overlay";overlay.innerHTML='<div id="neuvia-admin-dialog"><h2>Neuvia-Editor</h2><p id="neuvia-admin-error"></p><button type="button" id="neuvia-admin-close">Schließen</button></div>';document.body.appendChild(overlay);overlay.querySelector("#neuvia-admin-error").textContent=message;overlay.querySelector("#neuvia-admin-close").onclick=()=>overlay.remove();}
  function loginDialog(){
    const overlay=document.createElement("div");overlay.id="neuvia-admin-overlay";
    overlay.innerHTML='<form id="neuvia-admin-dialog"><h2>Administrator-Anmeldung</h2><label for="neuvia-admin-password">Passwort</label><input id="neuvia-admin-password" type="password" autocomplete="current-password" required><div id="neuvia-admin-error" role="status"></div><button id="neuvia-admin-submit" type="submit">Anmelden</button><button type="button" id="neuvia-admin-cancel">Abbrechen</button></form>';
    document.body.appendChild(overlay);
    overlay.querySelector("#neuvia-admin-cancel").onclick=()=>overlay.remove();
    overlay.onclick=e=>{if(e.target===overlay)overlay.remove()};
    overlay.querySelector("form").onsubmit=async e=>{
      e.preventDefault();const submit=overlay.querySelector("#neuvia-admin-submit"),error=overlay.querySelector("#neuvia-admin-error");
      submit.disabled=true;error.textContent="Prüfe Anmeldung …";
      try{const data=await request("/api/login",{method:"POST",body:JSON.stringify({password:overlay.querySelector("input").value})});sessionStorage.setItem(KEY,data.token);button.textContent="Bearbeiten";overlay.remove();editCurrentPage();}
      catch(err){error.textContent=err.message;submit.disabled=false;}
    };
    overlay.querySelector("input").focus();
  }
  async function editCurrentPage(){
    let overlay;
    try{
      const mapResponse=await fetch(MAP_URL,{cache:"no-store"});
      if(!mapResponse.ok)throw new Error("Seitenzuordnung fehlt. Bitte die Vorschau neu bauen lassen.");
      const map=await mapResponse.json();
      let route = decodeURIComponent(location.pathname).normalize("NFC");
      const basePath = adminScript ? new URL(adminScript.src).pathname.replace(/\/static\/neuvia-admin\.js$/, "").replace(/\/+$/, "") : "";
      if (basePath && (route === basePath || route.startsWith(basePath + "/"))) route = route.slice(basePath.length);
      const slug = route.replace(/^\/+|\/+$/g, "").replace(/\/index$/i, "").toLowerCase();
      const path=map[slug] || (slug===""?map[""]:null);
      if(!path)throw new Error("Für diese Seite wurde keine eindeutige Markdown-Datei gefunden.");
      const [data, linkResponse]=await Promise.all([
        request("/api/file?path="+encodeURIComponent(path)),
        fetch(LINK_URL,{cache:"force-cache"})
      ]);
      const linkItems=linkResponse.ok ? await linkResponse.json().catch(()=>[]) : [];
      overlay=document.createElement("div");overlay.id="neuvia-admin-overlay";
      overlay.innerHTML='<form id="neuvia-admin-dialog"><h2>Seite bearbeiten</h2><p id="neuvia-admin-path"></p><textarea id="neuvia-admin-content" spellcheck="false" aria-label="Markdown-Inhalt"></textarea><div id="neuvia-link-suggestions" role="listbox" aria-label="Vorhandene Neuvia-Seiten" hidden></div><p id="neuvia-link-help" style="font-size:12px;opacity:.7;margin:6px 0 12px">Verlinkungen: <code>[[</code> tippen und einen Seitentitel suchen.</p><label for="neuvia-admin-message">Commit-Nachricht</label><input id="neuvia-admin-message" value="Neuvia-Seite aktualisiert"><div id="neuvia-admin-error" role="status"></div><button id="neuvia-admin-submit" type="submit">Speichern</button><button type="button" id="neuvia-admin-cancel">Abbrechen</button></form>';
      document.body.appendChild(overlay);
      overlay.querySelector("#neuvia-admin-path").textContent=path;
      overlay.querySelector("#neuvia-admin-content").value=data.content;
      overlay.querySelector("#neuvia-admin-cancel").onclick=()=>overlay.remove();
      overlay.onclick=e=>{if(e.target===overlay)overlay.remove()};
      overlay.querySelector("form").onsubmit=async e=>{
        e.preventDefault();const submit=overlay.querySelector("#neuvia-admin-submit"),error=overlay.querySelector("#neuvia-admin-error");
        submit.disabled=true;error.textContent="Speichere auf GitHub …";
        try{
          const result=await request("/api/save",{method:"POST",body:JSON.stringify({path,content:overlay.querySelector("#neuvia-admin-content").value,message:overlay.querySelector("#neuvia-admin-message").value})});
          error.textContent="Gespeichert. Commit: "+result.commit.slice(0,7)+". Die Vorschau wird nach dem Build aktualisiert.";
          submit.textContent="Gespeichert";
        }catch(err){error.textContent=err.message;submit.disabled=false;}
      };
      const textarea=overlay.querySelector("#neuvia-admin-content");
      const suggestionBox=overlay.querySelector("#neuvia-link-suggestions");
      let activeLink=null, suggestions=[], selectedSuggestion=0;
      const normalize=value=>String(value||"").normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLocaleLowerCase("de");
      function findActiveLink(){
        const cursor=textarea.selectionStart;
        if(textarea.selectionEnd!==cursor)return null;
        const before=textarea.value.slice(0,cursor);
        const start=before.lastIndexOf("[[");
        if(start<0 || before.slice(start+2).includes("\n"))return null;
        if(before.lastIndexOf("]]")>start)return null;
        return {start,end:cursor,query:before.slice(start+2)};
      }
      function findSuggestions(query){
        const q=normalize(query.trim());
        return (Array.isArray(linkItems)?linkItems:[]).map(item=>{
          const title=normalize(item.title),target=normalize(item.target),path=normalize(item.path);
          const aliases=(item.aliases||[]).map(normalize);
          let score=99;
          if(!q)score=0;
          else if(title.startsWith(q))score=0;
          else if(aliases.some(x=>x.startsWith(q)))score=1;
          else if(target.startsWith(q))score=2;
          else if(path.startsWith(q))score=3;
          else if(title.includes(q))score=4;
          else if(aliases.some(x=>x.includes(q)))score=5;
          else if(target.includes(q)||path.includes(q))score=6;
          return {item,score};
        }).filter(x=>x.score<99)
          .sort((a,b)=>a.score-b.score||a.item.title.localeCompare(b.item.title,"de"))
          .slice(0,8).map(x=>x.item);
      }
      function placeSuggestions(){
        const rect=textarea.getBoundingClientRect();
        const width=Math.min(460,window.innerWidth-28);
        suggestionBox.style.left=Math.max(14,Math.min(rect.left+14,window.innerWidth-width-14))+"px";
        suggestionBox.style.top=Math.max(8,Math.min(rect.top+14,window.innerHeight-255))+"px";
      }
      function chooseSuggestion(item){
        if(!activeLink||!item)return;
        const before=textarea.value.slice(0,activeLink.start);
        const after=textarea.value.slice(activeLink.end);
        const inserted="[["+item.target+"]]";
        textarea.value=before+inserted+after;
        const cursor=before.length+inserted.length;
        textarea.setSelectionRange(cursor,cursor);
        textarea.dispatchEvent(new Event("input",{bubbles:true}));
        suggestionBox.hidden=true;
        textarea.focus();
      }
      function renderSuggestions(){
        activeLink=findActiveLink();
        suggestionBox.replaceChildren();
        if(!activeLink){suggestionBox.hidden=true;return;}
        suggestions=findSuggestions(activeLink.query);
        selectedSuggestion=0;
        if(!suggestions.length){
          const empty=document.createElement("div");
          empty.className="neuvia-link-empty";
          empty.textContent="Keine passende Seite gefunden.";
          suggestionBox.appendChild(empty);
        }else{
          suggestions.forEach((item,index)=>{
            const option=document.createElement("button");
            option.type="button";
            option.setAttribute("role","option");
            option.setAttribute("aria-selected",index===selectedSuggestion?"true":"false");
            const title=document.createElement("span");
            title.className="neuvia-link-title";
            title.textContent=item.title;
            const pathLabel=document.createElement("span");
            pathLabel.className="neuvia-link-path";
            pathLabel.textContent=item.path.replace(/\.md$/i,"");
            option.append(title,pathLabel);
            option.addEventListener("mousedown",event=>event.preventDefault());
            option.addEventListener("click",()=>chooseSuggestion(item));
            suggestionBox.appendChild(option);
          });
        }
        const help=document.createElement("div");
        help.className="neuvia-link-empty";
        help.textContent="↑ ↓ auswählen · Enter übernehmen · Esc schließen";
        suggestionBox.appendChild(help);
        suggestionBox.hidden=false;
        placeSuggestions();
      }
      textarea.addEventListener("input",renderSuggestions);
      textarea.addEventListener("click",renderSuggestions);
      textarea.addEventListener("keyup",event=>{
        if(["ArrowUp","ArrowDown","ArrowLeft","ArrowRight","Home","End"].includes(event.key))renderSuggestions();
      });
      textarea.addEventListener("keydown",event=>{
        if(suggestionBox.hidden)return;
        if(event.key==="Escape"){
          suggestionBox.hidden=true;
          event.preventDefault();
          return;
        }
        if(!suggestions.length)return;
        if(event.key==="ArrowDown"||event.key==="ArrowUp"){
          event.preventDefault();
          selectedSuggestion=(selectedSuggestion+(event.key==="ArrowDown"?1:-1)+suggestions.length)%suggestions.length;
          Array.from(suggestionBox.querySelectorAll('[role="option"]')).forEach((option,index)=>option.setAttribute("aria-selected",index===selectedSuggestion?"true":"false"));
          return;
        }
        if(event.key==="Enter"||event.key==="Tab"){
          event.preventDefault();
          chooseSuggestion(suggestions[selectedSuggestion]);
        }
      });
      window.addEventListener("resize",()=>{if(!suggestionBox.hidden)placeSuggestions();});
      overlay.querySelector("textarea").focus();
    }catch(err){if(overlay)overlay.remove();showMessage(err.message);}
  }
  button.onclick=()=>{if(!token()){loginDialog();return}editCurrentPage()};
  // Quartz navigates between pages without a full reload. Reattach the controls
  // if its navigation lifecycle replaces nodes inside the document body.
  const observer = new MutationObserver(() => {
    if (!button.isConnected) document.body.appendChild(button);
  });
  observer.observe(document.documentElement, { childList: true, subtree: true });
  if(token()){request("/api/session").then(d=>{if(d.authenticated){button.textContent="Bearbeiten"}else{sessionStorage.removeItem(KEY)}}).catch(()=>sessionStorage.removeItem(KEY));}
})();
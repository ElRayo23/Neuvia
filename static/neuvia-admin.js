(() => {
  const API = "https://neuvia-admin-api.forkleafcustom.workers.dev";
  const KEY = "neuviaAdminSession";
  const adminScript = document.querySelector('script[src*="neuvia-admin.js"]');
  const MAP_URL = adminScript ? new URL("neuvia-content-map.json", adminScript.src).toString() : "/static/neuvia-content-map.json";
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
    #neuvia-admin-dialog{box-sizing:border-box;width:min(760px,100%);max-height:92vh;overflow:auto;background:var(--light,#faf8f8);color:var(--dark,#2b2b2b);border:1px solid var(--lightgray,#ddd);border-radius:12px;padding:20px;font:14px sans-serif;box-shadow:0 12px 40px #0005}
    #neuvia-admin-dialog h2{margin:0 0 12px;font-size:20px}
    #neuvia-admin-dialog textarea{box-sizing:border-box;width:100%;min-height:55vh;resize:vertical;padding:12px;border:1px solid #999;border-radius:7px;background:var(--light,#fff);color:inherit;font:13px/1.5 ui-monospace,monospace}
    #neuvia-admin-dialog input{box-sizing:border-box;width:100%;padding:10px;border:1px solid #999;border-radius:7px;margin:6px 0 12px;background:transparent;color:inherit}
    #neuvia-admin-dialog button{padding:9px 13px;border:0;border-radius:7px;cursor:pointer;margin:10px 6px 0 0}
    #neuvia-admin-submit{background:var(--secondary,#284b63);color:white}
    #neuvia-admin-error{color:#c33;min-height:20px;margin:8px 0}
    #neuvia-edit-banner{position:fixed;left:12px;bottom:12px;z-index:99998;background:#805b19;color:white;padding:8px 12px;border-radius:8px;font:13px sans-serif;display:flex;gap:8px;align-items:center}
    #neuvia-edit-banner button{border:0;border-radius:5px;padding:6px 9px;cursor:pointer}
    body.neuvia-edit-mode #quartz-body article{outline:1px dashed #d99b35;outline-offset:5px}
  `;
  document.head.appendChild(style);
  const button=document.createElement("button");button.id="neuvia-admin-button";button.type="button";button.textContent="Anmelden";document.body.appendChild(button);
  let editMode=false;
  const banner=document.createElement("div");banner.id="neuvia-edit-banner";banner.innerHTML='<span>Bearbeitungsmodus</span><button type="button" id="neuvia-edit-page">Seite bearbeiten</button>';banner.hidden=true;document.body.appendChild(banner);
  function setMode(on){editMode=on;document.body.classList.toggle("neuvia-edit-mode",on);banner.hidden=!on;button.textContent=on?"Ansicht":"Bearbeiten";}
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
      try{const data=await request("/api/login",{method:"POST",body:JSON.stringify({password:overlay.querySelector("input").value})});sessionStorage.setItem(KEY,data.token);overlay.remove();setMode(true);}
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
      const basePath = adminScript ? new URL(adminScript.src).pathname.replace(/\/static\/neuvia-admin\.js$/, "").replace(/\\/+$/, "") : "";
      if (basePath && (route === basePath || route.startsWith(basePath + "/"))) route = route.slice(basePath.length);
      const slug = route.replace(/^\/+|\/+$/g, "").replace(/\/index$/i, "").toLowerCase();
      const path=map[slug] || map[decodeURIComponent(slug)] || (slug===""?map[""]:null);
      if(!path)throw new Error("Für diese Seite wurde keine eindeutige Markdown-Datei gefunden.");
      const data=await request("/api/file?path="+encodeURIComponent(path));
      overlay=document.createElement("div");overlay.id="neuvia-admin-overlay";
      overlay.innerHTML='<form id="neuvia-admin-dialog"><h2>Seite bearbeiten</h2><p id="neuvia-admin-path"></p><textarea id="neuvia-admin-content" spellcheck="false"></textarea><label for="neuvia-admin-message">Commit-Nachricht</label><input id="neuvia-admin-message" value="Neuvia-Seite aktualisiert"><div id="neuvia-admin-error" role="status"></div><button id="neuvia-admin-submit" type="submit">Speichern</button><button type="button" id="neuvia-admin-cancel">Abbrechen</button></form>';
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
      overlay.querySelector("textarea").focus();
    }catch(err){if(overlay)overlay.remove();showMessage(err.message);}
  }
  banner.querySelector("#neuvia-edit-page").onclick=editCurrentPage;
  button.onclick=()=>{if(!token()){loginDialog();return}if(editMode){setMode(false);return}setMode(true)};
  // Quartz navigates between pages without a full reload. Reattach the controls
  // if its navigation lifecycle replaces nodes inside the document body.
  const observer = new MutationObserver(() => {
    if (!button.isConnected) document.body.appendChild(button);
    if (!banner.isConnected) document.body.appendChild(banner);
  });
  observer.observe(document.documentElement, { childList: true, subtree: true });
  if(token()){request("/api/session").then(d=>{if(d.authenticated){button.textContent="Bearbeiten"}else{sessionStorage.removeItem(KEY)}}).catch(()=>sessionStorage.removeItem(KEY));}
})();
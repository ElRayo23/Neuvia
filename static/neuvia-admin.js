(() => {
  const API = "https://neuvia-admin-api.forkleafcustom.workers.dev";
  const KEY = "neuviaAdminSession";
  const token = () => sessionStorage.getItem(KEY) || "";
  const request = async (path, options={}) => {
    const headers = {"Content-Type":"application/json", ...(options.headers||{})};
    if (token()) headers.Authorization = "Bearer " + token();
    const res = await fetch(API + path, {...options, headers});
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || "Anfrage fehlgeschlagen.");
    return data;
  };
  const style = document.createElement("style");
  style.textContent = `
    #neuvia-admin-button{position:fixed;right:18px;top:16px;z-index:99999;border:0;border-radius:8px;padding:9px 14px;background:var(--secondary,#284b63);color:white;font:600 14px sans-serif;cursor:pointer;box-shadow:0 2px 10px #0003}
    #neuvia-admin-overlay{position:fixed;inset:0;z-index:100000;background:#0009;display:flex;align-items:center;justify-content:center;padding:18px}
    #neuvia-admin-dialog{width:min(360px,100%);background:var(--light,#faf8f8);color:var(--dark,#2b2b2b);border:1px solid var(--lightgray,#ddd);border-radius:12px;padding:22px;font:14px sans-serif;box-shadow:0 12px 40px #0005}
    #neuvia-admin-dialog h2{margin:0 0 14px;font-size:20px}#neuvia-admin-dialog input{box-sizing:border-box;width:100%;padding:11px;border:1px solid #999;border-radius:7px;margin:8px 0 12px;background:transparent;color:inherit}
    #neuvia-admin-dialog button{padding:9px 13px;border:0;border-radius:7px;cursor:pointer;margin-right:6px}#neuvia-admin-submit{background:var(--secondary,#284b63);color:white}#neuvia-admin-error{color:#c33;min-height:20px}
    body.neuvia-edit-mode [data-neuvia-editable]{outline:1px dashed #d99b35;outline-offset:3px}
    #neuvia-edit-banner{position:fixed;left:12px;bottom:12px;z-index:99998;background:#805b19;color:white;padding:8px 12px;border-radius:8px;font:13px sans-serif}
  `;
  document.head.appendChild(style);
  const button=document.createElement("button");button.id="neuvia-admin-button";button.type="button";button.textContent="Anmelden";document.body.appendChild(button);
  let editMode=false;
  const banner=document.createElement("div");banner.id="neuvia-edit-banner";banner.textContent="Bearbeitungsmodus – Editorfunktionen werden vorbereitet";banner.hidden=true;document.body.appendChild(banner);
  function setMode(on){editMode=on;document.body.classList.toggle("neuvia-edit-mode",on);banner.hidden=!on;button.textContent=on?"Ansicht":"Bearbeiten";}
  function dialog(){
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
  button.onclick=()=>{if(!token()){dialog();return}if(editMode){setMode(false);return}setMode(true)};
  if(token()){request("/api/session").then(d=>{if(d.authenticated){button.textContent="Bearbeiten"}else{sessionStorage.removeItem(KEY)}}).catch(()=>sessionStorage.removeItem(KEY));}
})();
---
title: Bestiary
---

# Bestiary

Homebrew-Monster verwalten. Änderungen bleiben zunächst in diesem Browser, bis du die JSON-Datei exportierst und im Repository ersetzt.

<div id="neuvia-bestiary" class="nb-root">
  <style>
    #neuvia-bestiary { color: var(--dark); }
    #neuvia-bestiary .nb-toolbar, #neuvia-bestiary .nb-panel { border: 1px solid var(--lightgray); border-radius: 10px; padding: 14px; margin: 12px 0; }
    #neuvia-bestiary .nb-toolbar { display: flex; flex-wrap: wrap; gap: 9px; align-items: center; }
    #neuvia-bestiary input, #neuvia-bestiary select, #neuvia-bestiary textarea { color: var(--dark); background: var(--light); border: 1px solid var(--gray); border-radius: 6px; padding: 8px; max-width: 100%; }
    #neuvia-bestiary input, #neuvia-bestiary select { min-height: 38px; }
    #neuvia-bestiary textarea { width: 100%; min-height: 88px; box-sizing: border-box; }
    #neuvia-bestiary button, #neuvia-bestiary .nb-button { border: 1px solid var(--gray); border-radius: 7px; padding: 8px 12px; background: var(--light); color: var(--dark); cursor: pointer; text-decoration: none; display: inline-block; }
    #neuvia-bestiary button:hover, #neuvia-bestiary .nb-button:hover { border-color: var(--secondary); }
    #neuvia-bestiary .nb-primary { background: var(--secondary); color: white; border-color: var(--secondary); }
    #neuvia-bestiary .nb-muted { color: var(--gray); font-size: .9em; }
    #neuvia-bestiary .nb-grid { display: grid; grid-template-columns: repeat(auto-fit,minmax(145px,1fr)); gap: 10px; }
    #neuvia-bestiary .nb-field { display: flex; flex-direction: column; gap: 5px; min-width: 0; }
    #neuvia-bestiary .nb-field label { font-size: .86em; color: var(--gray); }
    #neuvia-bestiary .nb-field input { width: 100%; box-sizing: border-box; }
    #neuvia-bestiary .nb-list { display: grid; gap: 8px; margin-top: 12px; }
    #neuvia-bestiary .nb-monster { display:flex; justify-content:space-between; gap:12px; align-items:center; text-align:left; width:100%; }
    #neuvia-bestiary .nb-monster strong { display:block; }
    #neuvia-bestiary .nb-stat { border-left: 3px solid var(--secondary); padding: 3px 0 3px 10px; margin: 8px 0; }
    #neuvia-bestiary .nb-section { border-top: 1px solid var(--lightgray); margin-top: 12px; padding-top: 10px; }
    #neuvia-bestiary .nb-actions { display:flex; flex-wrap:wrap; gap:8px; margin-top:12px; }
    #neuvia-bestiary .nb-danger { border-color: #b44; color: #b44; }
    #neuvia-bestiary .nb-hidden { display:none !important; }
    #neuvia-bestiary .nb-status { min-height: 1.4em; margin: 8px 0; }
    @media (min-width: 850px) { #neuvia-bestiary .nb-columns { display:grid; grid-template-columns:minmax(260px, .85fr) minmax(360px,1.4fr); gap:14px; align-items:start; } }
  </style>

  <div class="nb-toolbar">
    <button class="nb-primary" id="nb-add">+ Monster erstellen</button>
    <button id="nb-import">JSON importieren</button>
    <button id="nb-export">JSON exportieren</button>
    <input id="nb-file" type="file" accept=".json,application/json" hidden>
    <span class="nb-muted" id="nb-count">Lade Monster …</span>
  </div>
  <div class="nb-panel">
    <div class="nb-grid">
      <div class="nb-field"><label for="nb-search">Suche</label><input id="nb-search" type="search" placeholder="Monstername …"></div>
      <div class="nb-field"><label for="nb-type">Kreaturentyp</label><select id="nb-type"><option value="">Alle Typen</option></select></div>
      <div class="nb-field"><label for="nb-size">Größe</label><select id="nb-size"><option value="">Alle Größen</option><option>Tiny</option><option>Small</option><option>Medium</option><option>Large</option><option>Huge</option><option>Gargantuan</option></select></div>
      <div class="nb-field"><label for="nb-mincr">CR von</label><select id="nb-mincr"></select></div>
      <div class="nb-field"><label for="nb-maxcr">CR bis</label><select id="nb-maxcr"></select></div>
    </div>
  </div>
  <div class="nb-columns">
    <section class="nb-panel">
      <strong>Monsterliste</strong>
      <div class="nb-list" id="nb-list"><p class="nb-muted">Lade Daten …</p></div>
    </section>
    <section class="nb-panel" id="nb-editor">
      <p class="nb-muted">Wähle ein Monster aus oder erstelle ein neues.</p>
    </section>
  </div>
  <p class="nb-muted nb-status" id="nb-status" role="status" aria-live="polite"></p>
</div>

<script>
(() => {
  const root = document.getElementById("neuvia-bestiary");
  if (!root || root.dataset.initialized === "yes") return;
  root.dataset.initialized = "yes";
  const $ = (id) => root.querySelector("#" + id);
  const crValues = ["0","1/8","1/4","1/2", ...Array.from({length:30},(_,i)=>String(i+1))];
  const emptyMonster = () => ({name:"Neues Monster",size:"Medium",type:"Monstrosity",alignment:"Unaligned",cr:"1",ac:12,hp:20,speed:"30 ft.",abilities:{str:10,dex:10,con:10,int:10,wis:10,cha:10},traits:[],actions:[]});
  let monsters = [];
  let officialMonsters = [];
  let selected = -1;
  let loaded = false;
  const say = (message) => { $("nb-status").textContent = message; };
  const esc = (value) => String(value ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
  const crNumber = (cr) => { const s=String(cr ?? "0"); if(s.includes("/")) { const [a,b]=s.split("/").map(Number); return a/b; } return Number(s)||0; };
  const normalise = (m) => {
    const base = emptyMonster();
    const out = {...base,...m};
    out.abilities = {...base.abilities,...(m.abilities||{})};
    out.traits = Array.isArray(m.traits) ? m.traits : [];
    out.actions = Array.isArray(m.actions) ? m.actions : [];
    out.cr = String(out.cr ?? "0");
    return out;
  };
  const fillCr = () => {
    ["nb-mincr","nb-maxcr"].forEach(id => { $(id).innerHTML = crValues.map(v => '<option value="'+v+'">'+v+'</option>').join(""); });
    $("nb-mincr").value = "0"; $("nb-maxcr").value = "30";
  };
  const renderList = () => {
    const query = $("nb-search").value.toLowerCase().trim();
    const type = $("nb-type").value, size = $("nb-size").value;
    const min = crNumber($("nb-mincr").value), max = crNumber($("nb-maxcr").value);
    const all = [
      ...monsters.map((m,i)=>({...m,_kind:"homebrew",_index:i})),
      ...officialMonsters.map(m=>({...m,_kind:"official"}))
    ];
    const matches = all.filter(m =>
      (!query || [m.name,m.type,m.alignment,m.source].join(" ").toLowerCase().includes(query)) &&
      (!type || m.type === type) && (!size || m.size === size) &&
      crNumber(m.cr) >= min && crNumber(m.cr) <= max
    ).sort((a,b)=>a.name.localeCompare(b.name));
    $("nb-count").textContent = matches.length + " Treffer (" + monsters.length + " Homebrew, " + officialMonsters.length + " 5etools)";
    $("nb-list").innerHTML = matches.length ? matches.map(m => {
      const details = esc(m.size)+" "+esc(m.type);
      const meta = "CR "+esc(m.cr)+(m.source ? " · "+esc(m.source) : "");
      if (m._kind === "official") {
        return '<a class="nb-monster" href="'+esc(m.url)+'" target="_blank" rel="noopener noreferrer"><span><strong>'+esc(m.name)+'</strong><span class="nb-muted">'+details+' · 5etools</span></span><span class="nb-muted">'+meta+' ↗</span></a>';
      }
      return '<button class="nb-monster" data-select="'+m._index+'"><span><strong>'+esc(m.name)+'</strong><span class="nb-muted">'+details+' · Homebrew</span></span><span class="nb-muted">'+meta+'</span></button>';
    }).join("") : '<p class="nb-muted">Keine passenden Monster gefunden.</p>';
    const types = [...new Set(all.map(m=>m.type).filter(Boolean))].sort();
    const oldType = $("nb-type").value;
    $("nb-type").innerHTML = '<option value="">Alle Typen</option>' + types.map(t=>'<option value="'+esc(t)+'">'+esc(t)+'</option>').join("");
    $("nb-type").value = types.includes(oldType) ? oldType : "";
  };
  const loadOfficialMonsters = async () => {
    const indexUrl = "https://raw.githubusercontent.com/5etools-mirror-3/5etools-src/main/data/bestiary/index.json";
    try {
      $("nb-count").textContent = "Lade 5etools-Monster …";
      const indexResponse = await fetch(indexUrl);
      if (!indexResponse.ok) throw new Error("5etools-Quellenindex nicht erreichbar");
      const sourceIndex = await indexResponse.json();
      const files = [...new Set(Object.values(sourceIndex))];
      const loadedMonsters = [];
      for (let i=0; i<files.length; i+=8) {
        const batch = await Promise.all(files.slice(i,i+8).map(async file => {
          try {
            const response = await fetch("https://raw.githubusercontent.com/5etools-mirror-3/5etools-src/main/data/bestiary/"+file);
            if (!response.ok) return [];
            const data = await response.json();
            return Array.isArray(data.monster) ? data.monster : [];
          } catch (_) { return []; }
        }));
        batch.forEach(list => loadedMonsters.push(...list));
        $("nb-count").textContent = "Lade 5etools-Monster … "+Math.min(i+8,files.length)+"/"+files.length+" Quellen";
      }
      const sizeNames = {T:"Tiny",S:"Small",M:"Medium",L:"Large",H:"Huge",G:"Gargantuan"};
      const seen = new Set();
      officialMonsters = loadedMonsters.map(m => {
        const source = m.source || "";
        const key = (m.name||"").toLowerCase()+"|"+source.toLowerCase();
        if (!m.name || seen.has(key)) return null;
        seen.add(key);
        const rawType = typeof m.type === "string" ? m.type : (m.type && m.type.type) || "Unknown";
        const rawSize = Array.isArray(m.size) ? m.size.map(s=>sizeNames[s]||s).join("/") : (m.size||"Unknown");
        const rawCr = m.cr && typeof m.cr === "object" ? m.cr.cr : m.cr;
        const hash = encodeURIComponent((m.name+"_"+source).toLowerCase());
        return {name:m.name,source,type:rawType,size:rawSize,cr:String(rawCr ?? "0"),url:"/Neuvia/Bestiary/Monster/?name="+encodeURIComponent(m.name)+"&source="+encodeURIComponent(source)};
      }).filter(Boolean);
      renderList();
      say(officialMonsters.length+" 5etools-Monster aus "+files.length+" Quellen geladen.");
    } catch (error) {
      say("5etools-Liste konnte nicht geladen werden: "+error.message);
      renderList();
    }
  };
  const parseLines = (text) => text.split("\n").map(line=>line.trim()).filter(Boolean).map(line=>{
    const p=line.split(" — "); return {name:p.shift(),desc:p.join(" — ")};
  });
  const lines = (items) => (items||[]).map(x=>x.name+" — "+(x.desc||"")).join("\n");
  const renderEditor = () => {
    const m = monsters[selected];
    if (!m) { $("nb-editor").innerHTML = '<p class="nb-muted">Wähle ein Monster aus oder erstelle ein neues.</p>'; return; }
    $("nb-editor").innerHTML = `
      <div class="nb-field"><label for="ne-name">Name</label><input id="ne-name" value="${esc(m.name)}"></div>
      <div class="nb-grid" style="margin-top:10px">
        <div class="nb-field"><label for="ne-size">Größe</label><select id="ne-size">${["Tiny","Small","Medium","Large","Huge","Gargantuan"].map(v=>'<option '+(m.size===v?'selected':'')+'>'+v+'</option>').join("")}</select></div>
        <div class="nb-field"><label for="ne-type">Kreaturentyp</label><input id="ne-type" value="${esc(m.type)}"></div>
        <div class="nb-field"><label for="ne-alignment">Gesinnung</label><input id="ne-alignment" value="${esc(m.alignment)}"></div>
        <div class="nb-field"><label for="ne-cr">Challenge Rating</label><select id="ne-cr">${crValues.map(v=>'<option value="'+v+'" '+(m.cr===v?'selected':'')+'>'+v+'</option>').join("")}</select></div>
        <div class="nb-field"><label for="ne-ac">Armor Class</label><input id="ne-ac" type="number" min="0" value="${esc(m.ac)}"></div>
        <div class="nb-field"><label for="ne-hp">Hit Points</label><input id="ne-hp" type="number" min="0" value="${esc(m.hp)}"></div>
        <div class="nb-field"><label for="ne-speed">Speed</label><input id="ne-speed" value="${esc(m.speed)}"></div>
      </div>
      <div class="nb-section"><strong>Attribute</strong><div class="nb-grid" style="margin-top:8px">${["str","dex","con","int","wis","cha"].map(a=>'<div class="nb-field"><label for="ne-'+a+'">'+a.toUpperCase()+'</label><input id="ne-'+a+'" type="number" min="1" max="30" value="'+esc(m.abilities[a])+'"></div>').join("")}</div></div>
      <div class="nb-section"><div class="nb-field"><label for="ne-traits">Traits (eine pro Zeile: Name — Beschreibung)</label><textarea id="ne-traits">${esc(lines(m.traits))}</textarea></div></div>
      <div class="nb-section"><div class="nb-field"><label for="ne-actions">Aktionen (eine pro Zeile: Name — Beschreibung)</label><textarea id="ne-actions">${esc(lines(m.actions))}</textarea></div></div>
      <div class="nb-actions"><button class="nb-primary" id="ne-save">Änderungen übernehmen</button><button id="ne-delete" class="nb-danger">Monster löschen</button></div>
      <p class="nb-muted">Die Änderungen sind noch nicht im GitHub-Repository gespeichert. Nutze „JSON exportieren“ und ersetze damit die Datei im Repo.</p>
      <div class="nb-section" id="ne-preview"><strong>Statblock-Vorschau</strong><div class="nb-stat"><b>${esc(m.name)}</b><br>${esc(m.size)} ${esc(m.type)}, ${esc(m.alignment)}<br>AC ${esc(m.ac)} · HP ${esc(m.hp)} · Speed ${esc(m.speed)}<br>CR ${esc(m.cr)}</div><b>STR</b> ${esc(m.abilities.str)} · <b>DEX</b> ${esc(m.abilities.dex)} · <b>CON</b> ${esc(m.abilities.con)} · <b>INT</b> ${esc(m.abilities.int)} · <b>WIS</b> ${esc(m.abilities.wis)} · <b>CHA</b> ${esc(m.abilities.cha)}${(m.traits||[]).length?'<h4>Traits</h4>'+m.traits.map(x=>'<p><b>'+esc(x.name)+'.</b> '+esc(x.desc)+'</p>').join(""):""}${(m.actions||[]).length?'<h4>Actions</h4>'+m.actions.map(x=>'<p><b>'+esc(x.name)+'.</b> '+esc(x.desc)+'</p>').join(""):""}</div>
    `;
    $("ne-save").addEventListener("click", () => {
      const get = id => $(""+id).value.trim();
      m.name=get("ne-name")||"Unnamed Monster"; m.size=get("ne-size"); m.type=get("ne-type"); m.alignment=get("ne-alignment"); m.cr=get("ne-cr");
      m.ac=Number(get("ne-ac"))||0; m.hp=Number(get("ne-hp"))||0; m.speed=get("ne-speed");
      m.abilities={}; ["str","dex","con","int","wis","cha"].forEach(a=>m.abilities[a]=Number(get("ne-"+a))||10);
      m.traits=parseLines(get("ne-traits")); m.actions=parseLines(get("ne-actions"));
      renderList(); renderEditor(); say("Änderungen übernommen. Noch nicht ins Repository gespeichert.");
    });
    $("ne-delete").addEventListener("click", () => {
      if (!confirm("Dieses Monster wirklich aus der aktuellen JSON-Liste entfernen?")) return;
      monsters.splice(selected,1); selected=-1; renderList(); renderEditor(); say("Monster entfernt. Mit JSON exportieren dauerhaft sichern.");
    });
  };
  const importData = (data) => {
    const incoming = Array.isArray(data) ? data : data.monsters;
    if (!Array.isArray(incoming)) throw new Error("JSON muss ein Array oder ein Objekt mit einem 'monsters'-Array enthalten.");
    monsters = incoming.map(normalise); selected=-1; renderList(); renderEditor(); say(monsters.length+" Monster geladen.");
  };
  const exportData = () => {
    const blob = new Blob([JSON.stringify({schemaVersion:1,monsters},null,2)],{type:"application/json"});
    const url = URL.createObjectURL(blob), a=document.createElement("a");
    a.href=url; a.download="homebrew-monsters.json"; a.click(); URL.revokeObjectURL(url);
    say("JSON exportiert. Ersetze damit Bestiary/homebrew.json im GitHub-Repository.");
  };
  $("nb-add").addEventListener("click",()=>{monsters.push(emptyMonster());selected=monsters.length-1;renderList();renderEditor();say("Neues Monster angelegt.");});
  $("nb-import").addEventListener("click",()=>$("nb-file").click());
  $("nb-file").addEventListener("change",async e=>{const f=e.target.files[0];if(!f)return;try{importData(JSON.parse(await f.text()));}catch(err){say("Import fehlgeschlagen: "+err.message);}e.target.value="";});
  $("nb-export").addEventListener("click",exportData);
  ["nb-search","nb-type","nb-size","nb-mincr","nb-maxcr"].forEach(id=>$(id).addEventListener("input",renderList));
  $("nb-list").addEventListener("click",e=>{const b=e.target.closest("[data-select]");if(!b)return;selected=Number(b.dataset.select);renderEditor();});
  fillCr();
  loadOfficialMonsters();
  fetch("/Neuvia/Bestiary/homebrew.json").then(r=>{if(!r.ok)throw new Error("JSON-Datei nicht erreichbar");return r.json();}).then(importData).catch(err=>{monsters=[];loaded=true;renderList();renderEditor();say("Leere Startliste geladen ("+err.message+"). Du kannst Monster erstellen oder eine JSON-Datei importieren.");});
})();
</script>

---
title: Monster
---

<div id="neuvia-monster-detail">
  <style>
    #neuvia-monster-detail { color:var(--dark); max-width:1000px; margin:auto; }
    #neuvia-monster-detail .md-panel { border:1px solid var(--lightgray); border-radius:10px; padding:16px; margin:14px 0; }
    #neuvia-monster-detail .md-grid { display:grid; grid-template-columns:repeat(auto-fit,minmax(130px,1fr)); gap:10px; }
    #neuvia-monster-detail .md-field { display:flex; flex-direction:column; gap:5px; }
    #neuvia-monster-detail label { color:var(--gray); font-size:.88em; }
    #neuvia-monster-detail input,#neuvia-monster-detail textarea { width:100%; box-sizing:border-box; padding:9px; border:1px solid var(--gray); border-radius:6px; background:var(--light); color:var(--dark); }
    #neuvia-monster-detail textarea { min-height:320px; font-family:monospace; font-size:.88em; }
    #neuvia-monster-detail button { border:1px solid var(--gray); border-radius:7px; padding:9px 13px; background:var(--light); color:var(--dark); cursor:pointer; margin:4px 6px 4px 0; }
    #neuvia-monster-detail .md-primary { background:var(--secondary); color:white; border-color:var(--secondary); }
    #neuvia-monster-detail .md-muted { color:var(--gray); }
    #neuvia-monster-detail .md-stat { border-left:3px solid var(--secondary); padding-left:12px; margin:12px 0; }
    #neuvia-monster-detail pre { white-space:pre-wrap; overflow-wrap:anywhere; font-size:.9em; }
  </style>
  <p id="md-status" class="md-muted">Lade Monster …</p>
  <div id="md-content" hidden>
    <h1 id="md-name"></h1>
    <p id="md-meta" class="md-muted"></p>
    <div class="md-panel">
      <h2>Statblock</h2>
      <div id="md-preview"></div>
    </div>
    <div class="md-panel">
      <h2>Monster bearbeiten</h2>
      <p class="md-muted">Änderungen betreffen nur deine Homebrew-Kopie. Das Original aus 5etools bleibt unverändert.</p>
      <div class="md-grid">
        <div class="md-field"><label for="md-cr">Challenge Rating</label><input id="md-cr" placeholder="z. B. 6"></div>
        <div class="md-field"><label for="md-ac">Armor Class</label><input id="md-ac" type="number" min="0"></div>
        <div class="md-field"><label for="md-hp">Hit Points</label><input id="md-hp" type="number" min="0"></div>
        <div class="md-field"><label for="md-name-edit">Name der Homebrew-Version</label><input id="md-name-edit"></div>
      </div>
      <h3>Vollständige Monsterdaten (JSON)</h3>
      <p class="md-muted">Hier kannst du zusätzlich Attribute, Traits, Aktionen und weitere Werte bearbeiten. Die Datenstruktur des 5etools-Monsters bleibt dabei erhalten.</p>
      <textarea id="md-json" spellcheck="false"></textarea>
      <div>
        <button class="md-primary" id="md-apply">Änderungen übernehmen</button>
        <button id="md-export">Als Homebrew-JSON herunterladen</button>
      </div>
      <p id="md-feedback" class="md-muted" role="status" aria-live="polite"></p>
    </div>
  </div>
</div>

<script>
(() => {
  const root = document.getElementById("neuvia-monster-detail");
  if (!root || root.dataset.initialized) return;
  root.dataset.initialized = "yes";
  const $ = id => root.querySelector("#"+id);
  const params = new URLSearchParams(window.location.search);
  const name = params.get("name"), source = params.get("source");
  let original = null, edited = null;
  const say = message => $("md-feedback").textContent = message;
  const esc = value => String(value ?? "").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
  const sizeNames = {T:"Tiny",S:"Small",M:"Medium",L:"Large",H:"Huge",G:"Gargantuan"};
  const crText = cr => typeof cr === "object" ? (cr.cr ?? JSON.stringify(cr)) : (cr ?? "—");
  const acText = ac => Array.isArray(ac) ? ac.map(x=>typeof x==="number"?x:(x.ac ?? JSON.stringify(x))).join(" / ") : (typeof ac==="object" && ac ? ac.ac ?? JSON.stringify(ac) : ac ?? "—");
  const hpText = hp => typeof hp==="object" && hp ? (hp.average ?? "—")+(hp.formula ? " ("+hp.formula+")" : "") : hp ?? "—";
  const sizeText = size => Array.isArray(size) ? size.map(x=>sizeNames[x]||x).join(", ") : sizeNames[size] || size || "—";
  const entryText = entry => {
    if (typeof entry === "string") return entry;
    if (Array.isArray(entry)) return entry.map(entryText).join("\n");
    if (!entry || typeof entry !== "object") return String(entry ?? "");
    let out = entry.name ? entry.name+". " : "";
    if (entry.entries) out += entry.entries.map(entryText).join("\n");
    if (entry.entry) out += entryText(entry.entry);
    if (entry.items) out += entry.items.map(entryText).join("\n");
    if (entry.type === "list" && entry.items) out += entry.items.map(entryText).join("\n");
    if (entry.attack) out += JSON.stringify(entry.attack);
    return out || JSON.stringify(entry);
  };
  const renderPreview = () => {
    const m=edited, abilities=["str","dex","con","int","wis","cha"];
    const abilityLine=abilities.map(a=>"<b>"+a.toUpperCase()+"</b> "+esc(m[a] ?? "—")).join(" · ");
    const sections=[["Traits",m.trait],["Actions",m.action],["Bonus Actions",m.bonus],["Reactions",m.reaction],["Legendary Actions",m.legendary],["Mythic Actions",m.mythic]];
    $("md-name").textContent=m.name;
    $("md-meta").textContent=sizeText(m.size)+" "+(typeof m.type==="string"?m.type:(m.type?.type||"Unknown"))+" · "+(m.alignment||"Unaligned")+" · "+(m.source||source||"5etools");
    $("md-preview").innerHTML='<div class="md-stat"><b>AC</b> '+esc(acText(m.ac))+' · <b>HP</b> '+esc(hpText(m.hp))+'<br><b>Speed</b> '+esc(typeof m.speed==="object"?JSON.stringify(m.speed):m.speed||"—")+'<br><b>CR</b> '+esc(crText(m.cr))+'</div><p>'+abilityLine+'</p>'+sections.filter(s=>Array.isArray(s[1])&&s[1].length).map(([title,items])=>'<h3>'+title+'</h3>'+items.map(item=>'<p>'+esc(entryText(item))+'</p>').join("")).join("");
    $("md-cr").value=crText(m.cr);
    $("md-ac").value=Array.isArray(m.ac)?(typeof m.ac[0]==="number"?m.ac[0]:(m.ac[0]?.ac ?? "")):(typeof m.ac==="object"?(m.ac?.ac??""):m.ac??"");
    $("md-hp").value=typeof m.hp==="object"?(m.hp.average??""):(m.hp??"");
    $("md-name-edit").value=m.name||"";
    $("md-json").value=JSON.stringify(m,null,2);
  };
  const setCr = value => {
    if (edited.cr && typeof edited.cr==="object") edited.cr={...edited.cr,cr:value};
    else edited.cr=value;
  };
  $("md-apply").addEventListener("click",()=>{
    try {
      const data=JSON.parse($("md-json").value);
      data.name=$("md-name-edit").value.trim()||data.name;
      const cr=$("md-cr").value.trim();
      if (cr) {
        if (data.cr && typeof data.cr==="object") data.cr={...data.cr,cr};
        else data.cr=cr;
      }
      const ac=Number($("md-ac").value);
      if ($("md-ac").value!=="") data.ac=Array.isArray(data.ac)?[{...(typeof data.ac[0]==="object"?data.ac[0]:{}),ac}]:ac;
      const hp=Number($("md-hp").value);
      if ($("md-hp").value!=="") data.hp=typeof data.hp==="object"?{...data.hp,average:hp}:hp;
      edited=data;
      renderPreview();
      say("Änderungen übernommen. Noch nicht dauerhaft gespeichert.");
    } catch(error) { say("JSON-Fehler: "+error.message); }
  });
  $("md-export").addEventListener("click",()=>{
    try {
      const data=JSON.parse($("md-json").value);
      data.name=$("md-name-edit").value.trim()||data.name;
      const cr=$("md-cr").value.trim();
      if(cr) data.cr=(data.cr&&typeof data.cr==="object")?{...data.cr,cr}:cr;
      const ac=Number($("md-ac").value);
      if($("md-ac").value!=="") data.ac=Array.isArray(data.ac)?[{...(typeof data.ac[0]==="object"?data.ac[0]:{}),ac}]:ac;
      const hp=Number($("md-hp").value);
      if($("md-hp").value!=="") data.hp=typeof data.hp==="object"?{...data.hp,average:hp}:hp;
      const abilities={str:data.str??10,dex:data.dex??10,con:data.con??10,int:data.int??10,wis:data.wis??10,cha:data.cha??10};
      const entries=list=>(Array.isArray(list)?list:[]).map(x=>({name:x.name||x.type||"Eintrag",desc:entryText(x)}));
      const homebrew={name:data.name,size:sizeText(data.size),type:typeof data.type==="string"?data.type:(data.type?.type||"Unknown"),alignment:Array.isArray(data.alignment)?data.alignment.join(", "):(data.alignment||"Unaligned"),cr:String(crText(data.cr)),ac:Number(acText(data.ac))||12,hp:Number(typeof data.hp==="object"?data.hp.average:data.hp)||1,speed:typeof data.speed==="string"?data.speed:JSON.stringify(data.speed||"30 ft."),abilities,traits:entries(data.trait),actions:entries(data.action),sourceData:data};
      const blob=new Blob([JSON.stringify({schemaVersion:1,monsters:[homebrew]},null,2)],{type:"application/json"});
      const url=URL.createObjectURL(blob),a=document.createElement("a");a.href=url;a.download=(String(data.name||"monster").toLowerCase().replace(/[^a-z0-9]+/g,"-")||"monster")+"-homebrew.json";a.click();URL.revokeObjectURL(url);
      say("Homebrew-Kopie exportiert. Das 5etools-Original bleibt unverändert.");
    } catch(error) { say("Export fehlgeschlagen: "+error.message); }
  });
  const load=async()=>{
    if(!name||!source) throw new Error("Monstername oder Quelle fehlt in der URL.");
    const base="https://raw.githubusercontent.com/5etools-mirror-3/5etools-src/main/data/bestiary/";
    const index=await (await fetch(base+"index.json")).json();
    const file=Object.values(index).find(f=>f.toLowerCase()===source.toLowerCase()+".json"||f.toLowerCase()===source.toLowerCase());
    if(!file) throw new Error("Quelle nicht im 5etools-Index gefunden: "+source);
    const data=await (await fetch(base+file)).json();
    original=(data.monster||[]).find(m=>m.name===name&&String(m.source||"").toLowerCase()===source.toLowerCase());
    if(!original) throw new Error("Monster in der Quelle nicht gefunden.");
    edited=JSON.parse(JSON.stringify(original));
    $("md-content").hidden=false;
    renderPreview();
    $("md-status").textContent="Originaldaten von 5etools geladen. Bearbeite die Werte und exportiere deine Homebrew-Kopie.";
  };
  load().catch(error=>$("md-status").textContent="Fehler: "+error.message);
})();
</script>

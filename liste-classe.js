/*
  CARTE « LISTE DE LA CLASSE » (accueil) — liste alphabétique des élèves, à télécharger en PDF (A4).

  L'enseignant renseigne : nom de l'école, circonscription scolaire, groupe pédagogique, classe (obligatoires),
  puis la liste des élèves (import .txt / .csv / .xlsx, collage ou saisie un par un, avec le sexe G / F).
  Le PDF contient :
    - l'en-tête (école, circonscription, groupe, classe, année scolaire) ;
    - la liste classée par ordre alphabétique (NOM puis prénoms), numérotée, les FILLES en ROUGE ;
    - un petit tableau de statistiques (garçons, filles, total, pourcentages) ;
    - en bas à gauche le Directeur, en bas à droite l'enseignant(e), chacun avec sa place de signature.
  Au-delà d'une page (beaucoup d'élèves), la liste continue sur les pages suivantes ; statistiques et signatures
  figurent sur la dernière page.

  Dépend de index.html : state, render, escapeHtml, downloadPdfBlob, dlProgressStart, dlProgressDone, html2pdf,
  waitForImages (facultatif), getSession (facultatif : pré-remplit le nom de l'enseignant).
*/
(function(){
'use strict';

var LS_KEY = 'fpb_liste_classe_v1';
var CLASSES = ['CI','CP','CE1','CE2','CM1','CM2'];
var S = { loaded:false, ecole:'', circ:'', groupe:'', classe:'', directeur:'', enseignant:'', eleves:[] };
var errMsg = '', uid = 0, quickSexe = 'G';

function esc(x){ return (typeof escapeHtml === 'function') ? escapeHtml(String(x==null?'':x)) : String(x==null?'':x).replace(/[&<>"]/g,function(c){ return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]; }); }
function cleanName(x){ return String(x == null ? '' : x).replace(/\s+/g,' ').trim(); }

/* ------------------------------------------------------------------ */
/* Données                                                              */
/* ------------------------------------------------------------------ */
function load(){
  if(S.loaded) return; S.loaded = true;
  try{
    var o = JSON.parse(localStorage.getItem(LS_KEY) || '{}') || {};
    ['ecole','circ','groupe','classe','directeur','enseignant'].forEach(function(k){ if(typeof o[k] === 'string') S[k] = o[k]; });
    if(Array.isArray(o.eleves)) S.eleves = o.eleves.filter(function(e){ return e && e.n; }).map(function(e){ return { id:++uid, n:cleanName(e.n), f:!!e.f }; });
  }catch(e){}
  if(!S.enseignant){
    try{
      var se = (typeof getSession === 'function') ? getSession() : null;
      if(se){ var nm = cleanName(((se.prenom||'') + ' ' + (se.nom||''))); if(nm) S.enseignant = nm; }
    }catch(e){}
  }
}
function save(){
  try{
    localStorage.setItem(LS_KEY, JSON.stringify({ ecole:S.ecole, circ:S.circ, groupe:S.groupe, classe:S.classe, directeur:S.directeur, enseignant:S.enseignant,
      eleves:S.eleves.map(function(e){ return { n:e.n, f:e.f }; }) }));
  }catch(e){}
}

/* Clé de tri : sans accents ni majuscules, « NOM Prénoms ». */
function sortKey(n){ return String(n).normalize('NFD').replace(/[̀-ͯ]/g,'').toLowerCase().replace(/[^a-z0-9 ]/g,' ').replace(/\s+/g,' ').trim(); }
function sorted(){
  return S.eleves.slice().sort(function(a,b){
    var ka = sortKey(a.n), kb = sortKey(b.n);
    return ka < kb ? -1 : ka > kb ? 1 : 0;
  });
}
function stats(list){
  var f = list.filter(function(e){ return e.f; }).length, t = list.length;
  return { f:f, g:t - f, t:t };
}
function pct(x, t){ return t ? (x * 100 / t).toFixed(1).replace(/\.0$/, '').replace('.', ',') + ' %' : '0 %'; }

/* ------------------------------------------------------------------ */
/* Import / saisie                                                      */
/* ------------------------------------------------------------------ */
var SEXE_RE = /^(m|g|f|masculin|f[ée]minin|fille|gar[çc]on)$/i;
var FILLE_RE = /^(f|f[ée]minin|fille)$/i;
/* Une ligne (cellules) -> { n, f } : le sexe est lu dans une cellule M / G / F (ou « fille », « garçon »…). */
function cellsToEleve(cells){
  var f = false, parts = [];
  cells.map(cleanName).forEach(function(t){
    if(!t) return;
    if(/^\d+([.,)]\d*)?$/.test(t)) return;               // colonne de numérotation
    if(SEXE_RE.test(t)){ if(FILLE_RE.test(t)) f = true; return; }
    parts.push(t);
  });
  var n = cleanName(parts.join(' '));
  if(parts.length === 1){                                 // « NOM Prénoms F » dans une seule cellule
    var m = n.match(/^(.*\S)\s+(m|g|f)$/i);
    if(m){ n = cleanName(m[1]); f = /^f$/i.test(m[2]); }
  }
  n = cleanName(n.replace(/^\d+\s*[.)\-:]\s*/, '').replace(/^\d+\s+(?=\D)/, ''));
  return n ? { n:n, f:f } : null;
}
function looksHeader(name){ return /^(n[°o]?\s*)?(noms?|pr[ée]noms?|[ée]l[èe]ves?|liste)(\s|$)/i.test(name) && name.split(' ').length <= 6; }
function parseText(txt){
  var out = [];
  String(txt || '').replace(/\r/g,'').split('\n').forEach(function(l){
    if(!cleanName(l)) return;
    var cells = l.indexOf('\t') >= 0 ? l.split('\t') : (l.indexOf(';') >= 0 ? l.split(';') : [l]);
    var e = cellsToEleve(cells); if(e) out.push(e);
  });
  if(out.length && looksHeader(out[0].n)) out.shift();
  return out;
}
function parseRows(rows){
  var out = [];
  rows.forEach(function(r){ var e = cellsToEleve(r || []); if(e) out.push(e); });
  if(out.length && looksHeader(out[0].n)) out.shift();
  return out;
}
function decodeBuf(buf){
  try{ return new TextDecoder('utf-8', { fatal:true }).decode(buf); }catch(e){}
  try{ return new TextDecoder('windows-1252').decode(buf); }catch(e){}
  return new TextDecoder().decode(buf);
}
function loadSheetJS(){
  if(window.XLSX) return Promise.resolve();
  return new Promise(function(res, rej){
    var sc = document.createElement('script');
    sc.src = 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js';
    sc.onload = function(){ res(); }; sc.onerror = function(){ rej(new Error('xlsx')); };
    document.head.appendChild(sc);
  });
}
function addEleves(arr){
  arr.forEach(function(e){ S.eleves.push({ id:++uid, n:e.n, f:!!e.f }); });
  save();
}
async function importFile(file){
  errMsg = '';
  try{
    var buf = await file.arrayBuffer(), arr = [];
    if(/\.xlsx?$/i.test(file.name)){
      await loadSheetJS();
      var wb = XLSX.read(buf, { type:'array' });
      arr = parseRows(XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header:1, raw:false, defval:'' }));
    } else {
      arr = parseText(decodeBuf(buf));
    }
    if(!arr.length) errMsg = 'Aucun nom trouvé dans ce fichier. Colle plutôt la liste dans la zone prévue (un élève par ligne).';
    else addEleves(arr);
  }catch(e){
    console.error(e);
    errMsg = 'Impossible de lire ce fichier. Utilise un fichier .txt, .csv ou .xlsx, ou colle la liste dans la zone prévue.';
  }
  renderListeClasse();
}

/* ------------------------------------------------------------------ */
/* Style de l'écran                                                     */
/* ------------------------------------------------------------------ */
function ensureStyle(){
  if(document.getElementById('lc-style')) return;
  var st = document.createElement('style'); st.id = 'lc-style';
  st.textContent = ''
    + '.lc-box{background:#fff;border:1px solid var(--line,#E3E8EF);border-radius:14px;padding:12px;margin:0 0 12px}'
    + '.lc-tt{font-family:Poppins,sans-serif;font-weight:800;font-size:13px;color:var(--blue,#0A6FD8);margin:0 0 8px}'
    + '.lc-lb{display:block;font-size:12px;font-weight:700;color:var(--ink-soft,#5B6577);margin:9px 0 4px}'
    + '.lc-lb:first-of-type{margin-top:0}'
    + '.lc-in{width:100%;box-sizing:border-box;border:1.5px solid var(--line,#E3E8EF);border-radius:10px;padding:10px;font-size:14px;font-family:inherit;color:var(--ink,#1B2740);background:#fff}'
    + '.lc-in:focus{outline:none;border-color:var(--blue,#0A6FD8)}'
    + '.lc-two{display:grid;grid-template-columns:1fr 1fr;gap:8px}'
    + '.lc-ta{min-height:96px;resize:vertical;margin-top:8px}'
    + '.lc-btn2{display:block;width:100%;border:1.5px dashed var(--blue,#0A6FD8);background:#F3F8FF;color:var(--blue,#0A6FD8);border-radius:12px;padding:11px;font-weight:800;font-size:13.5px;cursor:pointer;touch-action:manipulation;text-align:center;box-sizing:border-box}'
    + '.lc-row{display:flex;gap:8px;margin-top:8px;align-items:center}'
    + '.lc-row button{border:1.5px solid var(--line,#E3E8EF);background:#fff;border-radius:10px;padding:10px 12px;font-weight:700;font-size:13px;cursor:pointer;color:var(--ink,#1B2740);touch-action:manipulation}'
    + '.lc-row button.pri{background:var(--blue,#0A6FD8);border-color:var(--blue,#0A6FD8);color:#fff;white-space:nowrap}'
    + '.lc-seg{display:flex;flex:none}.lc-seg button{padding:10px 13px;border-radius:0}'
    + '.lc-seg button:first-child{border-radius:10px 0 0 10px}.lc-seg button:last-child{border-radius:0 10px 10px 0;border-left:none}'
    + '.lc-seg button.on{background:#1E3A8A;border-color:#1E3A8A;color:#fff}'
    + '.lc-seg button.on.f{background:#D81B1B;border-color:#D81B1B}'
    + '.lc-list{margin-top:10px;border-top:1px solid var(--line,#E3E8EF)}'
    + '.lc-el{display:flex;align-items:center;gap:8px;padding:7px 2px;border-bottom:1px solid #EEF1F6;font-size:13.5px}'
    + '.lc-el .no{width:26px;color:#94A3B8;font-size:12px;text-align:right;flex:none}'
    + '.lc-el .nm{flex:1;min-width:0;font-weight:600;color:var(--ink,#1B2740);overflow-wrap:anywhere}'
    + '.lc-el .nm.f{color:#D81B1B}'
    + '.lc-sx{flex:none;width:34px;border:1.5px solid #CBD5E1;background:#fff;border-radius:8px;padding:5px 0;font-weight:800;font-size:12.5px;cursor:pointer;color:#1E3A8A;touch-action:manipulation}'
    + '.lc-sx.f{background:#D81B1B;border-color:#D81B1B;color:#fff}'
    + '.lc-x{flex:none;border:none;background:none;color:#94A3B8;font-size:18px;line-height:1;cursor:pointer;padding:2px 6px}'
    + '.lc-note{font-size:12px;color:var(--ink-soft,#5B6577);margin:6px 0 0;line-height:1.4}'
    + '.lc-go{width:100%;margin:6px 0 0;border:none;background:var(--blue,#0A6FD8);color:#fff;border-radius:12px;padding:13px;font-weight:800;font-size:14px;cursor:pointer;touch-action:manipulation}'
    + '.lc-err{font-size:12.5px;color:#B3261E;background:#FDECEA;border-radius:8px;padding:8px 10px;margin:8px 0 0}'
    + '.lc-st{width:100%;border-collapse:collapse;font-size:13px;margin-top:10px}'
    + '.lc-st th{background:#1E3A8A;color:#fff;padding:6px;border:1px solid #1E3A8A}'
    + '.lc-st td{padding:6px;border:1px solid #CBD5E1;text-align:center;font-weight:700}';
  document.head.appendChild(st);
}

/* ------------------------------------------------------------------ */
/* Écran                                                                */
/* ------------------------------------------------------------------ */
window.openListeClasse = function(){
  load();
  state = { view:'listeClasse' };
  render();
  window.scrollTo(0,0);
};

function listHtml(){
  var l = sorted();
  if(!l.length) return '<p class="lc-note" style="text-align:center;margin:12px 0 2px">Aucun élève pour le moment.</p>';
  return '<div class="lc-list">' + l.map(function(e, i){
    return '<div class="lc-el"><span class="no">'+(i+1)+'</span><span class="nm'+(e.f?' f':'')+'">'+esc(e.n)+'</span>'
      + '<button type="button" class="lc-sx'+(e.f?' f':'')+'" onclick="LC.toggle('+e.id+')" aria-label="Changer le sexe">'+(e.f?'F':'G')+'</button>'
      + '<button type="button" class="lc-x" onclick="LC.del('+e.id+')" aria-label="Supprimer">×</button></div>';
  }).join('') + '</div>';
}
function statsHtml(){
  var s = stats(S.eleves);
  if(!s.t) return '';
  return '<table class="lc-st"><tr><th></th><th>Garçons</th><th>Filles</th><th>Total</th></tr>'
    + '<tr><td style="text-align:left">Effectif</td><td>'+s.g+'</td><td style="color:#D81B1B">'+s.f+'</td><td>'+s.t+'</td></tr>'
    + '<tr><td style="text-align:left">Pourcentage</td><td>'+pct(s.g,s.t)+'</td><td style="color:#D81B1B">'+pct(s.f,s.t)+'</td><td>100 %</td></tr></table>';
}
function refreshList(){
  var a = document.getElementById('lc-list'); if(a) a.innerHTML = listHtml();
  var b = document.getElementById('lc-stats'); if(b) b.innerHTML = statsHtml();
}

function renderListeClasse(){
  ensureStyle(); load();
  var vp = document.getElementById('viewport'); if(!vp) return;
  var dl = '<datalist id="lc-cl">' + CLASSES.map(function(c){ return '<option value="'+c+'">'; }).join('') + '</datalist>';
  vp.innerHTML = '<button class="backbtn" onclick="state={view:\'list\'}; render();">← Retour</button>'
    + '<div class="masthead" style="border-bottom:none;margin-bottom:10px"><div><span class="eyebrow">Document de classe</span><h1>Liste <em>de la classe</em></h1></div></div>'
    + '<p class="lc-note" style="margin:0 0 12px">Liste alphabétique des élèves, filles en rouge, avec statistiques et signatures du Directeur et de l’enseignant. À télécharger en PDF.</p>'
    + '<div class="lc-box"><div class="lc-tt">1. Informations</div>'
    +   '<label class="lc-lb" for="lc-ecole">Nom de l’école *</label><input id="lc-ecole" class="lc-in" value="'+esc(S.ecole)+'" placeholder="Ex. EPP Adjarra-Centre" oninput="LC.set(\'ecole\',this.value)">'
    +   '<label class="lc-lb" for="lc-circ">Circonscription scolaire *</label><input id="lc-circ" class="lc-in" value="'+esc(S.circ)+'" placeholder="Ex. Adjarra" oninput="LC.set(\'circ\',this.value)">'
    +   '<div class="lc-two"><div><label class="lc-lb" for="lc-groupe">Groupe pédagogique *</label><input id="lc-groupe" class="lc-in" value="'+esc(S.groupe)+'" placeholder="Ex. 3" oninput="LC.set(\'groupe\',this.value)"></div>'
    +   '<div><label class="lc-lb" for="lc-classe">Classe *</label><input id="lc-classe" class="lc-in" list="lc-cl" value="'+esc(S.classe)+'" placeholder="Ex. CM1" oninput="LC.set(\'classe\',this.value)">'+dl+'</div></div>'
    +   '<label class="lc-lb" for="lc-dir">Nom du Directeur / de la Directrice (facultatif)</label><input id="lc-dir" class="lc-in" value="'+esc(S.directeur)+'" oninput="LC.set(\'directeur\',this.value)">'
    +   '<label class="lc-lb" for="lc-ens">Nom de l’enseignant(e) (facultatif)</label><input id="lc-ens" class="lc-in" value="'+esc(S.enseignant)+'" oninput="LC.set(\'enseignant\',this.value)">'
    + '</div>'
    + '<div class="lc-box"><div class="lc-tt">2. Élèves</div>'
    +   '<label class="lc-btn2">Importer un fichier (.txt, .csv, .xlsx)<input type="file" accept=".txt,.csv,.tsv,.xlsx,.xls,text/plain,text/csv" style="display:none" onchange="LC.file(this)"></label>'
    +   '<textarea id="lc-paste" class="lc-in lc-ta" placeholder="Ou colle ici la liste, un élève par ligne.\nPour une fille, ajoute F à la fin : AGBO Marie ; F\nPour un garçon : DOSSOU Paul ; G"></textarea>'
    +   '<div class="lc-row"><button type="button" class="pri" style="flex:1" onclick="LC.paste()">Ajouter ces élèves</button></div>'
    +   '<div class="lc-row"><input id="lc-quick" class="lc-in" style="flex:1;min-width:0" placeholder="NOM et Prénoms" onkeydown="if(event.key===\'Enter\'){event.preventDefault();LC.quick();}">'
    +     '<div class="lc-seg"><button type="button" class="'+(quickSexe==='G'?'on':'')+'" onclick="LC.qsex(\'G\')">G</button><button type="button" class="f '+(quickSexe==='F'?'on f':'')+'" onclick="LC.qsex(\'F\')">F</button></div>'
    +     '<button type="button" class="pri" onclick="LC.quick()">+</button></div>'
    +   '<p class="lc-note">Écris le NOM en premier : le classement alphabétique se fait sur le NOM puis les prénoms. Touche G / F devant un élève pour changer son sexe.</p>'
    +   '<div id="lc-list">'+listHtml()+'</div>'
    +   '<div class="lc-row"><button type="button" onclick="LC.clear()">Vider la liste</button></div>'
    +   '<div id="lc-stats">'+statsHtml()+'</div>'
    + '</div>'
    + (errMsg ? '<div class="lc-err">'+esc(errMsg)+'</div>' : '')
    + '<button type="button" class="lc-go" onclick="LC.pdf()">Télécharger la liste en PDF</button>'
    + '<div style="height:16px"></div>';
}
window.renderListeClasse = renderListeClasse;

/* ------------------------------------------------------------------ */
/* Mise en page du PDF (pages A4 de 794 × 1123 px)                      */
/* ------------------------------------------------------------------ */
var NAVY = '#16327A', INK = '#0F172A', SOFT = '#475569', RED = '#D81B1B';
var PAGE_H = 1123, PAD_T = 40, PAD_B = 36, HEAD1 = 236, HEADN = 96, THEAD = 30, FOOT = 304, GAP = 10;

function anneeScolaire(){
  var d = new Date(), y = d.getFullYear();
  return d.getMonth() >= 7 ? (y+'-'+(y+1)) : ((y-1)+'-'+y);
}

/* Découpe la liste en pages : { first, last, rows:[…], cols, rowH }. */
function plan(n){
  var cols = n > 24 ? 2 : 1, ROWH = 26, pages = [], start = 0;
  function avail(first, last){ return PAGE_H - PAD_T - PAD_B - (first ? HEAD1 : HEADN) - THEAD - GAP - (last ? FOOT : 0); }
  function cap(first, last){ return Math.floor(avail(first, last) / ROWH) * cols; }
  while(true){
    var first = pages.length === 0, left = n - start;
    if(left <= cap(first, true)){
      var rpc = Math.ceil(Math.max(left, 1) / cols);
      var rowH = (first && start === 0) ? Math.max(ROWH, Math.min(36, Math.floor(avail(true, true) / rpc))) : ROWH;
      pages.push({ first:first, last:true, from:start, to:n, cols:cols, rowH:rowH });
      break;
    }
    var c = cap(first, false);
    pages.push({ first:first, last:false, from:start, to:start + c, cols:cols, rowH:ROWH });
    start += c;
  }
  return pages;
}

function infoLine(label, val, flex){
  return '<div style="display:flex;align-items:flex-end;flex:'+(flex||1)+';min-width:0;font-size:14px;font-weight:700;color:'+INK+'"><span style="white-space:nowrap">'+label+' :&nbsp;</span>'
    + '<span style="flex:1;min-width:0;border-bottom:1.5px dotted #64748B;font-weight:800;color:'+NAVY+';padding:0 4px 1px;white-space:nowrap;overflow:hidden;text-overflow:clip">'+esc(val)+'</span></div>';
}
function rowHtml(e, i, w, h, fs){
  var c = e.f ? RED : INK;
  return '<div style="display:flex;align-items:center;height:'+h+'px;box-sizing:border-box;border:1px solid #CBD5E1;border-top:none;'+(i%2 ? 'background:#F8FAFC;' : '')+'font-size:'+fs+'px;color:'+c+';font-weight:'+(e.f?800:600)+'">'
    + '<span style="width:34px;flex:none;text-align:center;font-weight:700;color:'+(e.f?RED:SOFT)+';border-right:1px solid #CBD5E1;height:100%;display:flex;align-items:center;justify-content:center">'+(i+1)+'</span>'
    + '<span style="flex:1;min-width:0;padding:0 8px;white-space:nowrap;overflow:hidden">'+esc(e.n)+'</span>'
    + '<span style="width:34px;flex:none;text-align:center;font-weight:800;border-left:1px solid #CBD5E1;height:100%;display:flex;align-items:center;justify-content:center">'+(e.f?'F':'G')+'</span></div>';
}
function tableHtml(list, p){
  var rows = list.slice(p.from, p.to), cols = p.cols, per = Math.ceil(rows.length / cols);
  var long = rows.some(function(e){ return e.n.length > (cols === 2 ? 30 : 56); });
  var fs = cols === 1 ? (long ? 13 : 15) : (long ? 11 : 12.5);
  var head = '<div style="display:flex;height:'+THEAD+'px;background:'+NAVY+';color:#fff;font-weight:800;font-size:12.5px;align-items:center;box-sizing:border-box;border:1px solid '+NAVY+'">'
    + '<span style="width:34px;flex:none;text-align:center">N°</span><span style="flex:1;padding:0 8px">Nom et prénoms</span><span style="width:34px;flex:none;text-align:center">Sexe</span></div>';
  var out = '';
  for(var c = 0; c < cols; c++){
    var part = rows.slice(c * per, (c + 1) * per);
    if(!part.length) continue;
    out += '<div style="flex:1;min-width:0">' + head + part.map(function(e, k){ return rowHtml(e, p.from + c * per + k, 0, p.rowH, fs); }).join('') + '</div>';
  }
  return '<div style="display:flex;gap:16px;align-items:flex-start">' + out + '</div>';
}
function footerHtml(list){
  var s = stats(list);
  var cell = 'padding:7px 10px;border:1px solid #CBD5E1;text-align:center;font-weight:800;font-size:13.5px;';
  var sign = function(titre, nom){
    return '<div style="width:300px;text-align:center">'
      + '<div style="font-weight:800;font-size:15px;color:'+NAVY+';text-decoration:underline;text-underline-offset:3px">'+titre+'</div>'
      + '<div style="height:70px"></div>'
      + '<div style="font-size:11.5px;color:'+SOFT+';border-top:1px dashed #94A3B8;padding-top:3px;margin:0 30px">Signature et cachet</div>'
      + '<div style="margin-top:8px;font-weight:800;font-size:14.5px;color:'+INK+';min-height:20px">'+(nom ? esc(nom) : '')+'</div></div>';
  };
  return '<div style="position:absolute;left:48px;right:48px;bottom:'+PAD_B+'px;height:'+(FOOT-14)+'px">'
    + '<div style="display:flex;align-items:flex-start;gap:24px">'
    +   '<table style="border-collapse:collapse;color:'+INK+'"><tr><th colspan="4" style="background:'+NAVY+';color:#fff;padding:6px 10px;font-size:13px;letter-spacing:1px;border:1px solid '+NAVY+'">STATISTIQUES</th></tr>'
    +     '<tr style="background:#EEF2FF"><td style="'+cell+'"></td><td style="'+cell+'">Garçons</td><td style="'+cell+'color:'+RED+'">Filles</td><td style="'+cell+'">Total</td></tr>'
    +     '<tr><td style="'+cell+'text-align:left">Effectif</td><td style="'+cell+'">'+s.g+'</td><td style="'+cell+'color:'+RED+'">'+s.f+'</td><td style="'+cell+'">'+s.t+'</td></tr>'
    +     '<tr><td style="'+cell+'text-align:left">Pourcentage</td><td style="'+cell+'">'+pct(s.g,s.t)+'</td><td style="'+cell+'color:'+RED+'">'+pct(s.f,s.t)+'</td><td style="'+cell+'">100 %</td></tr></table>'
    +   '<div style="font-size:12px;color:'+SOFT+';line-height:1.5;padding-top:4px"><span style="color:'+RED+';font-weight:800">Rouge</span> : les filles.<br>Classement par ordre alphabétique.</div>'
    + '</div>'
    + '<div style="position:absolute;left:0;right:0;bottom:0;display:flex;justify-content:space-between">'
    +   sign('Le Directeur', S.directeur) + sign('L’Enseignant(e)', S.enseignant)
    + '</div></div>';
}
function buildPage(list, p, idx, total){
  var page = document.createElement('div');
  page.style.cssText = "position:relative;width:794px;height:"+PAGE_H+"px;box-sizing:border-box;overflow:hidden;background:#fff;font-family:'Inter','Poppins',Arial,sans-serif;color:"+INK+";";
  var classeTxt = cleanName(S.classe), an = anneeScolaire();
  var head;
  if(p.first){
    head = '<div style="height:'+HEAD1+'px">'
      + '<div style="display:flex;justify-content:space-between;align-items:center;font-size:12px;font-weight:700;color:'+SOFT+'"><span style="display:flex;align-items:center"><span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:#F59E0B;margin-right:7px"></span><span style="font-weight:800;font-size:14px;color:'+NAVY+'">FicheProBot</span></span><span>Année scolaire '+an+'</span></div>'
      + '<div style="text-align:center;margin-top:14px"><div style="font-size:12px;font-weight:700;letter-spacing:3px;color:'+SOFT+'">LISTE ALPHABÉTIQUE</div>'
      + '<div style="font-size:27px;font-weight:800;color:'+NAVY+';margin-top:4px">DE LA CLASSE DE '+esc(classeTxt.toUpperCase())+'</div>'
      + '<div style="width:90px;height:4px;border-radius:2px;background:#F59E0B;margin:9px auto 0"></div></div>'
      + '<div style="margin-top:16px;display:flex;flex-direction:column;gap:12px">'
      +   infoLine('École', S.ecole)
      +   '<div style="display:flex;gap:22px">'+infoLine('Circonscription scolaire', S.circ, 1.6)+infoLine('Groupe pédagogique', S.groupe, 1)+'</div>'
      +   '<div style="display:flex;gap:22px">'+infoLine('Classe', classeTxt, 1.6)+infoLine('Effectif', String(list.length), 1)+'</div>'
      + '</div></div>';
  } else {
    head = '<div style="height:'+HEADN+'px"><div style="display:flex;justify-content:space-between;align-items:center;font-size:12px;font-weight:700;color:'+SOFT+'"><span style="font-weight:800;font-size:14px;color:'+NAVY+'">FicheProBot</span><span>Année scolaire '+an+'</span></div>'
      + '<div style="text-align:center;margin-top:12px;font-size:20px;font-weight:800;color:'+NAVY+'">LISTE ALPHABÉTIQUE — '+esc(classeTxt.toUpperCase())+' <span style="font-size:13px;color:'+SOFT+';font-weight:700">(suite)</span></div>'
      + '<div style="text-align:center;margin-top:6px;font-size:12.5px;font-weight:700;color:'+SOFT+'">'+esc(S.ecole)+'</div></div>';
  }
  page.innerHTML = '<div style="position:absolute;left:0;right:0;top:0;height:14px;background:linear-gradient(100deg,'+NAVY+',#2B5BE0)"></div>'
    + '<div style="position:absolute;left:48px;right:48px;top:'+(PAD_T + 14)+'px">' + head + '<div style="height:'+GAP+'px"></div>' + tableHtml(list, p) + '</div>'
    + (p.last ? footerHtml(list) : '')
    + '<div style="position:absolute;left:48px;right:48px;bottom:14px;display:flex;justify-content:space-between;font-size:10px;color:#94A3B8"><span>FicheProBot — l’éducation autrement</span><span>Page '+(idx+1)+' / '+total+'</span></div>';
  return page;
}
function buildPages(){
  var list = sorted(), pl = plan(list.length);
  return pl.map(function(p, i){ return buildPage(list, p, i, pl.length); });
}

/* ------------------------------------------------------------------ */
/* PDF                                                                  */
/* ------------------------------------------------------------------ */
async function newA4Pdf(){
  return await html2pdf().set({ jsPDF:{ unit:'mm', format:'a4', orientation:'portrait', compress:true } }).from(document.createElement('div')).toPdf().get('pdf');
}
async function addPage(pageEl, doc, first){
  var root = document.getElementById('pdf-root');
  if(!root){ root = document.createElement('div'); root.id = 'pdf-root'; document.body.appendChild(root); }
  root.innerHTML = ''; root.appendChild(pageEl);
  if(typeof waitForImages === 'function') await waitForImages(root);
  var canvas = await html2pdf().set({ html2canvas:{ scale:3.5, useCORS:true, letterRendering:true, backgroundColor:'#ffffff', scrollX:0, scrollY:0 } })
    .from(pageEl).toCanvas().get('canvas');
  if(!first) doc.addPage();
  var data = null, fmt = 'PNG';
  try{ data = canvas.toDataURL('image/png'); }catch(e){ data = null; }
  if(!data || data.length > 4500000){ data = canvas.toDataURL('image/jpeg', 0.97); fmt = 'JPEG'; }
  doc.addImage(data, fmt, 0, 0, 210, 297, undefined, 'FAST');
  root.innerHTML = '';
}
function fileSlug(t){ return String(t||'').normalize('NFD').replace(/[̀-ͯ]/g,'').replace(/[^A-Za-z0-9]+/g,'_').replace(/^_+|_+$/g,''); }

async function pdf(){
  errMsg = '';
  var manque = [];
  if(!cleanName(S.ecole)) manque.push('le nom de l’école');
  if(!cleanName(S.circ)) manque.push('la circonscription scolaire');
  if(!cleanName(S.groupe)) manque.push('le groupe pédagogique');
  if(!cleanName(S.classe)) manque.push('la classe');
  if(manque.length){ errMsg = 'Renseigne d’abord : ' + manque.join(', ') + '.'; renderListeClasse(); window.scrollTo(0, document.body.scrollHeight); return; }
  if(!S.eleves.length){ errMsg = 'Ajoute au moins un élève à la liste.'; renderListeClasse(); window.scrollTo(0, document.body.scrollHeight); return; }
  if(typeof html2pdf === 'undefined'){ alert("Le module PDF n'est pas encore chargé. Vérifie ta connexion puis réessaie."); return; }
  try{
    dlProgressStart('Création de ton PDF', 'Mise en page de la liste…');
    var doc = await newA4Pdf(), pages = buildPages();
    for(var i = 0; i < pages.length; i++) await addPage(pages[i], doc, i === 0);
    downloadPdfBlob(doc.output('blob'), 'Liste_alphabetique_' + (fileSlug(S.classe) || 'classe') + '.pdf');
  }catch(err){
    console.error(err);
    try{ dlProgressDone(); }catch(_){}
    alert('Impossible de créer le PDF. Réessaie.');
  }
}

window.LC = {
  set: function(k, v){ S[k] = String(v || ''); save(); },
  file: function(inp){ var f = inp && inp.files && inp.files[0]; if(f) importFile(f); if(inp) inp.value = ''; },
  paste: function(){
    var ta = document.getElementById('lc-paste'); if(!ta) return;
    var arr = parseText(ta.value); errMsg = '';
    if(!arr.length){ errMsg = 'Colle d’abord des noms (un élève par ligne).'; renderListeClasse(); return; }
    addEleves(arr); renderListeClasse();
  },
  qsex: function(x){ quickSexe = x; var q = document.getElementById('lc-quick'), v = q ? q.value : ''; renderListeClasse(); var q2 = document.getElementById('lc-quick'); if(q2){ q2.value = v; q2.focus(); } },
  quick: function(){
    var q = document.getElementById('lc-quick'); if(!q) return;
    var n = cleanName(q.value); if(!n) return;
    errMsg = ''; addEleves([{ n:n, f:quickSexe === 'F' }]); refreshList(); q.value = ''; q.focus();
  },
  toggle: function(id){ S.eleves.forEach(function(e){ if(e.id === id) e.f = !e.f; }); save(); refreshList(); },
  del: function(id){ S.eleves = S.eleves.filter(function(e){ return e.id !== id; }); save(); refreshList(); },
  clear: function(){ if(S.eleves.length && !confirm('Vider toute la liste des élèves ?')) return; S.eleves = []; errMsg = ''; save(); renderListeClasse(); },
  pdf: pdf,
  _pages: buildPages, _state: S, _parse: parseText, _sorted: sorted
};
})();

/*
  CARTE « EXPRESSION ÉCRITE » (accueil) — classes CE1 à CM2.

  L'enseignant choisit la classe puis télécharge en PDF (A4) le CAHIER D'EXPRESSION ÉCRITE à faire photocopier pour les élèves :
      Expression écrite | Unité | Types d'incorrections (Gram. · Orth. · Conj. · Syntaxe · Autres) | Appréciation de l'enseignant | Note
  Chaque type de texte (Affiche, Lettre familière, Description, Carte d'invitation, Récit, Lettre administrative, Article de journal)
  occupe autant de lignes que de textes prévus dans la classe. Les autres textes du programme (compte rendu, règles de jeu…)
  sont ajoutés à la suite, chacun sur sa ligne avec son nom exact. Un type absent du programme de la classe n'apparaît pas.

  Les textes viennent du projet de planification (rubrique « expression écrite » de chaque unité, 12 unités par classe) :
  le type de texte de chaque unité est fixé dans EE_PLAN ci-dessous (clé = numéro d'unité).

  Liste des élèves (import .txt / .csv / .xlsx ou saisie) : le PDF contient une PAGE DE GARDE puis UNE PAGE PAR ÉLÈVE
  (nom et prénoms déjà inscrits, numéro de page en bas). Sans liste : page de garde + une page vierge à photocopier.

  Dépend de index.html : state, render, escapeHtml, downloadPdfBlob, dlProgressStart, dlProgressDone, html2pdf.
*/
(function(){
'use strict';

var CLASSES = ['CE1','CE2','CM1','CM2'];
var LS_KEY = 'fpb_expr_ecrite_v1';

/* Lignes du cahier, dans l'ordre du modèle manuscrit. */
var TYPES = [
  { k:'affiche',     nom:'Affiche' },
  { k:'lettre',      nom:'Lettre familière' },
  { k:'description', nom:'Description' },
  { k:'invitation',  nom:'Carte d\u2019invitation' },
  { k:'recit',       nom:'Récit' },
  { k:'admin',       nom:'Lettre administrative' },
  { k:'article',     nom:'Article de journal' }
];

/* Texte produit à chaque unité (1er jet de la semaine 1). 'x' = autre type de texte : [ 'x', 'nom du texte' ]. */
var EE_PLAN = {
  CE1: { 1:'affiche', 2:'lettre', 3:'lettre', 4:'description', 5:'invitation', 6:['x','Présentation écrite à des camarades'], 7:'lettre', 8:['x','Consigne'],
         9:'recit', 10:'article', 11:'lettre', 12:['x','Liste de services communiquée aux parents'] },
  CE2: { 1:'lettre', 2:['x','Questionnaire d\u2019enquête'], 3:'lettre', 4:'affiche', 5:'recit', 6:['x','Règles d\u2019un jeu'], 7:'article', 8:'recit',
         9:['x','Compte rendu de visite'], 10:'lettre', 11:['x','Message de condoléances'], 12:['x','Projet de vacances'] },
  CM1: { 1:'lettre', 2:'affiche', 3:'article', 4:['x','Compte rendu'], 5:'recit', 6:'article', 7:'admin', 8:'lettre', 9:'recit', 10:'lettre',
         11:'recit', 12:'affiche' },
  CM2: { 1:'description', 2:'affiche', 3:'recit', 4:'lettre', 5:['x','Compte rendu'], 6:'recit', 7:'article', 8:'article', 9:'affiche',
         10:'admin', 11:'lettre', 12:'lettre' }
};

var S = { classe:'', loaded:false, eleves:{} };
var errMsg = '';

function esc(x){ return (typeof escapeHtml === 'function') ? escapeHtml(String(x==null?'':x)) : String(x==null?'':x).replace(/[&<>"]/g,function(c){ return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]; }); }

function load(){
  if(S.loaded) return; S.loaded = true;
  try{
    var o = JSON.parse(localStorage.getItem(LS_KEY) || '{}') || {};
    if(o.classe && CLASSES.indexOf(o.classe) >= 0) S.classe = o.classe;
    if(o.eleves && typeof o.eleves === 'object') CLASSES.forEach(function(k){
      if(Array.isArray(o.eleves[k])) S.eleves[k] = o.eleves[k].map(function(x){ return String(x); }).filter(Boolean);
    });
  }catch(e){}
}
function save(){ try{ localStorage.setItem(LS_KEY, JSON.stringify({ classe:S.classe, eleves:S.eleves })); }catch(e){} }

/* ------------------------------------------------------------------ */
/* Liste des élèves                                                     */
/* ------------------------------------------------------------------ */
function liste(c){ return S.eleves[c] || []; }
function cleanName(x){ return String(x == null ? '' : x).replace(/\s+/g,' ').trim(); }
/* Une ligne de tableau -> « NOM Prénoms » : on retire les colonnes de numérotation (nombres) et de sexe (M / F / G). */
function rowToName(cells){
  return cells.map(cleanName).filter(function(t){ return t && !/^\d+([.,)]\d*)?$/.test(t) && !/^[MFGmfg]$/.test(t); }).join(' ');
}
function looksHeader(name){ return /^(n[°o]?\s*)?(noms?|pr[ée]noms?|[ée]l[èe]ves?|liste)(\s|$)/i.test(name) && name.split(" ").length <= 6; }
function parseText(txt){
  var out = [];
  String(txt || '').replace(/\r/g,'').split('\n').forEach(function(l){
    if(!cleanName(l)) return;
    var cells = l.indexOf('\t') >= 0 ? l.split('\t') : (l.indexOf(';') >= 0 ? l.split(';') : [l]);
    var n = rowToName(cells);
    /* « 1. Nom », « 1) Nom », « 1 - Nom » : numérotation en tête de ligne retirée. */
    n = cleanName(n.replace(/^\d+\s*[.)\-:]\s*/, '').replace(/^\d+\s+(?=\D)/, ''));
    if(n) out.push(n);
  });
  if(out.length && looksHeader(out[0])) out.shift();
  return out;
}
function parseRows(rows){
  var out = [];
  rows.forEach(function(r){ var n = rowToName(r || []); if(n) out.push(n); });
  if(out.length && looksHeader(out[0])) out.shift();
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
async function importFile(file){
  var c = S.classe; if(!c || !file) return;
  errMsg = '';
  try{
    var buf = await file.arrayBuffer(), names = [];
    if(/\.xlsx?$/i.test(file.name)){
      await loadSheetJS();
      var wb = XLSX.read(buf, { type:'array' });
      names = parseRows(XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header:1, raw:false, defval:'' }));
    } else {
      names = parseText(decodeBuf(buf));
    }
    if(!names.length) errMsg = 'Aucun nom trouvé dans ce fichier. Colle plutôt la liste dans la zone ci-dessous (un élève par ligne).';
    else { S.eleves[c] = names; save(); }
  }catch(e){
    console.error(e);
    errMsg = 'Impossible de lire ce fichier. Utilise un fichier .txt, .csv ou .xlsx, ou colle la liste ci-dessous.';
  }
  renderExpression();
}

/* Blocs du cahier pour une classe : [{ nom, rows:[{ u, label }] , other:bool }] — uniquement les types qui ont au moins un texte. */
function blocks(c){
  var plan = EE_PLAN[c] || {}, units = Object.keys(plan).map(Number).sort(function(a,b){ return a-b; });
  var out = [];
  TYPES.forEach(function(t){
    var rows = units.filter(function(u){ return plan[u] === t.k; }).map(function(u){ return { u:u, label:'' }; });
    if(rows.length) out.push({ nom:t.nom, rows:rows, other:false });
  });
  var oth = units.filter(function(u){ return Array.isArray(plan[u]); }).map(function(u){ return { u:u, label:plan[u][1] }; });
  if(oth.length) out.push({ nom:'Autres textes', rows:oth, other:true });
  return out;
}
function countText(c){
  var n = liste(c).length;
  return n ? n+' élève'+(n>1?'s':'')+' dans la liste de '+esc(c)+' : le cahier aura '+n+' page'+(n>1?'s':'')+' d\u2019élève.' : 'Aucun élève pour l\u2019instant : le cahier contiendra une page vierge.';
}
function total(bl){ return bl.reduce(function(n,b){ return n + b.rows.length; }, 0); }

/* ------------------------------------------------------------------ */
/* Style de l'écran                                                     */
/* ------------------------------------------------------------------ */
function ensureStyle(){
  if(document.getElementById('ee-style')) return;
  var st = document.createElement('style'); st.id = 'ee-style';
  st.textContent = ''
    + '.ee-box{background:#fff;border:1px solid var(--line,#E3E8EF);border-radius:14px;padding:12px;margin:0 0 12px}'
    + '.ee-tt{font-family:Poppins,sans-serif;font-weight:800;font-size:13px;color:var(--blue,#0A6FD8);margin:0 0 8px}'
    + '.ee-chips{display:grid;grid-template-columns:repeat(4,1fr);gap:6px}'
    + '.ee-chip{border:1.5px solid var(--line,#E3E8EF);background:#fff;border-radius:10px;padding:9px 2px;font-weight:800;font-size:14px;color:var(--ink,#1B2740);cursor:pointer;touch-action:manipulation}'
    + '.ee-chip.on{background:var(--blue,#0A6FD8);border-color:var(--blue,#0A6FD8);color:#fff}'
    + '.ee-tbl{width:100%;border-collapse:collapse;font-size:12.5px}'
    + '.ee-tbl th{background:#1E3A8A;color:#fff;font-weight:700;padding:7px 6px;text-align:center;border:1px solid #1E3A8A}'
    + '.ee-tbl th:first-child,.ee-tbl td:first-child{text-align:left}'
    + '.ee-tbl td{padding:7px 6px;border:1px solid #CBD5E1;text-align:center;color:var(--ink,#1B2740)}'
    + '.ee-tbl tr.tot td{font-weight:800;background:#EEF2FF}'
    + '.ee-go{width:100%;margin:6px 0 0;border:none;background:var(--blue,#0A6FD8);color:#fff;border-radius:12px;padding:13px;font-weight:800;font-size:14px;cursor:pointer;touch-action:manipulation}'
    + '.ee-note{font-size:12px;color:var(--ink-soft,#5B6577);margin:6px 0 0;line-height:1.4}'
    + '.ee-btn2{display:block;width:100%;border:1.5px dashed var(--blue,#0A6FD8);background:#F3F8FF;color:var(--blue,#0A6FD8);border-radius:12px;padding:11px;font-weight:800;font-size:13.5px;cursor:pointer;touch-action:manipulation;text-align:center;box-sizing:border-box}'
    + '.ee-ta{width:100%;box-sizing:border-box;min-height:120px;border:1.5px solid var(--line,#E3E8EF);border-radius:10px;padding:9px;font-size:13px;font-family:inherit;color:var(--ink,#1B2740);resize:vertical;margin-top:8px}'
    + '.ee-row{display:flex;gap:8px;margin-top:8px}.ee-row button{flex:1;border:1.5px solid var(--line,#E3E8EF);background:#fff;border-radius:10px;padding:10px 4px;font-weight:700;font-size:13px;cursor:pointer;color:var(--ink,#1B2740)}'
    + '.ee-row button.pri{background:var(--blue,#0A6FD8);border-color:var(--blue,#0A6FD8);color:#fff}'
    + '.ee-err{font-size:12.5px;color:#B3261E;background:#FDECEA;border-radius:8px;padding:8px 10px;margin:8px 0 0}';
  document.head.appendChild(st);
}

/* ------------------------------------------------------------------ */
/* Écran                                                                */
/* ------------------------------------------------------------------ */
window.openExpressionEcrite = function(){
  load();
  state = { view:'expression' };
  render();
  window.scrollTo(0,0);
};

function renderExpression(){
  ensureStyle(); load();
  var vp = document.getElementById('viewport'); if(!vp) return;
  var c = S.classe;
  var chips = CLASSES.map(function(k){
    return '<button type="button" class="ee-chip'+(c===k?' on':'')+'" onclick="EE.classe(\''+k+'\')">'+k+'</button>';
  }).join('');

  var body = '';
  if(!c){
    body = '<p class="ee-note" style="text-align:center;margin:14px 0">Choisis ta classe pour voir le contenu du cahier.</p>';
  } else {
    var bl = blocks(c), n = total(bl);
    var rows = bl.map(function(b){
      if(b.other) return b.rows.map(function(r){ return '<tr><td>'+esc(r.label)+' <small style="color:#64748B">(U'+r.u+')</small></td><td style="font-weight:800">1</td></tr>'; }).join('');
      return '<tr><td>'+esc(b.nom)+'</td><td style="font-weight:800">'+b.rows.length+'</td></tr>';
    }).join('');
    body = '<div class="ee-tt" style="margin-top:4px">2. Contenu du cahier de '+esc(c)+'</div><div class="ee-box" style="padding:8px">'
      + '<table class="ee-tbl"><tr><th>Type de texte</th><th>Nombre de textes</th></tr>' + rows
      + '<tr class="tot"><td>Total</td><td>'+n+'</td></tr></table></div>'
      + '<div class="ee-tt" style="margin-top:12px">3. Liste des élèves</div><div class="ee-box">'
      +   '<label class="ee-btn2">Importer un fichier (.txt, .csv, .xlsx)<input type="file" accept=".txt,.csv,.tsv,.xlsx,.xls,text/plain,text/csv" style="display:none" onchange="EE.file(this)"></label>'
      +   '<textarea id="ee-list" class="ee-ta" placeholder="Ou colle / saisis ici un élève par ligne (NOM et Prénoms)" oninput="EE.text(this.value)">'+esc(liste(c).join('\n'))+'</textarea>'
      +   '<div class="ee-row"><button type="button" onclick="EE.clear()">Vider la liste</button></div>'
      +   '<p class="ee-note" id="ee-count">'+countText(c)+'</p>'
      + '</div>'
      + (errMsg ? '<div class="ee-err">'+esc(errMsg)+'</div>' : '')
      + '<button type="button" class="ee-go" onclick="EE.pdf()">Télécharger le cahier en PDF</button>'
      + '<p class="ee-note" style="text-align:center">Page de garde, puis '+(liste(c).length ? 'une page par élève (son nom est déjà inscrit, avec le numéro de page).' : 'une page vierge à photocopier (ajoute la liste pour avoir une page par élève).')+'</p>';
  }

  vp.innerHTML = '<button class="backbtn" onclick="state={view:\'list\'}; render();">← Retour</button>'
    + '<div class="masthead" style="border-bottom:none;margin-bottom:10px"><div><span class="eyebrow">Cahier de l\u2019élève</span><h1>Expression <em>écrite</em></h1></div></div>'
    + '<p class="ee-note" style="margin:0 0 12px">Choisis ta classe : le cahier d\u2019expression écrite contient une ligne par texte à produire dans l\u2019année, selon le projet de planification.</p>'
    + '<div class="ee-box"><div class="ee-tt">1. Ta classe</div><div class="ee-chips">'+chips+'</div></div>'
    + body + '<div style="height:16px"></div>';
}
window.renderExpression = renderExpression;

/* ------------------------------------------------------------------ */
/* PDF                                                                  */
/* ------------------------------------------------------------------ */
function buildPdf(c, rowH){
  var bl = blocks(c);
  var NAVY = '#16327A', BLUE = '#2563EB', INK = '#0F172A', SOFT = '#475569';
  var page = document.createElement('div');
  page.style.cssText = "position:relative;width:794px;height:1123px;box-sizing:border-box;overflow:hidden;background:#fff;font-family:'Inter','Poppins',Arial,sans-serif;color:"+INK+";";
  var B = '1.3px solid #334155', b = 'border:'+B+';';
  var th = b+'background:'+NAVY+';color:#fff;font-weight:700;font-size:12px;text-align:center;padding:7px 3px;';
  var sub = b+'background:#E8EEFA;color:'+NAVY+';font-weight:700;font-size:11.5px;text-align:center;padding:6px 3px;';
  var cols = '<colgroup><col style="width:118px"><col style="width:44px"><col style="width:60px"><col style="width:60px"><col style="width:60px"><col style="width:68px"><col style="width:60px"><col style="width:166px"><col style="width:68px"></colgroup>';
  var head = '<tr><th rowspan="2" colspan="2" style="'+th+'font-size:14px">Expression écrite</th><th colspan="5" style="'+th+'font-size:13px">Types d’incorrections</th><th colspan="2" style="'+th+'font-size:13px">Appréciation de l’enseignant</th></tr>'
    + '<tr><th style="'+sub+'">Gram.</th><th style="'+sub+'">Orth.</th><th style="'+sub+'">Conj.</th><th style="'+sub+'">Syntaxe</th><th style="'+sub+'">Autres</th><th style="'+sub+'">Appréciation</th><th style="'+sub+'">Note</th></tr>';
  var empty = '';
  for(var i=0;i<7;i++) empty += '<td style="'+b+'background:#fff"></td>';
  var body = '';
  bl.forEach(function(blk){
    blk.rows.forEach(function(r, i){
      var first = '';
      if(blk.other) first = '<td style="'+b+'padding:4px 7px;font-weight:700;font-size:11.5px;line-height:1.25;vertical-align:middle;background:#F5F8FD;color:'+INK+'">'+esc(r.label)+'</td>';
      else if(i === 0) first = '<td rowspan="'+blk.rows.length+'" style="'+b+'padding:4px 7px;font-weight:800;font-size:13.5px;line-height:1.25;vertical-align:middle;background:#F5F8FD;color:'+NAVY+'">'+esc(blk.nom)+'</td>';
      var unit = '<td style="'+b+'text-align:center;font-size:11px;font-weight:700;color:'+BLUE+';vertical-align:middle;background:#fff">U'+r.u+'</td>';
      body += '<tr style="height:'+rowH+'px">'+first+unit+empty+'</tr>';
    });
  });
  var fit = document.createElement('div');
  fit.style.cssText = 'width:100%;';
  fit.innerHTML = ''
    + '<div style="display:flex;justify-content:space-between;align-items:center">'
    +   '<div style="display:flex;align-items:center"><span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:#F59E0B;margin-right:8px"></span><span style="font-weight:800;font-size:15px;color:'+NAVY+'">FicheProBot</span></div>'
    +   '<div style="font-size:12px;font-weight:600;color:'+SOFT+'">Cahier de l’élève</div></div>'
    + '<div style="background:linear-gradient(100deg,'+NAVY+',#2B5BE0);border-radius:14px;padding:18px 22px;color:#fff;text-align:center;margin-top:12px">'
    +   '<div style="font-size:24px;font-weight:800;letter-spacing:.5px">CAHIER D’EXPRESSION ÉCRITE</div>'
    +   '<div style="display:inline-block;background:rgba(255,255,255,.18);border-radius:20px;padding:3px 16px;font-size:13px;font-weight:700;margin-top:8px">Classe : '+esc(c)+'</div></div>'
    + '<div style="margin:14px 2px;font-size:14px;font-weight:700;display:flex;align-items:flex-end;color:'+INK+'"><span style="white-space:nowrap">NOM et Prénoms :&nbsp;</span><span id="ee-name" style="flex:1;height:24px;border-bottom:1.5px dotted #64748B"></span></div>'
    + '<table style="width:704px;border-collapse:collapse;table-layout:fixed;border:'+B+'">'+cols+head+body+'</table>'
    + '<div style="font-size:10.5px;color:'+SOFT+';margin-top:7px">U = unité du projet de planification du '+esc(c)+' (un texte par unité).</div>';
  var inner = document.createElement('div');
  inner.style.cssText = 'position:absolute;left:40px;right:40px;top:34px;height:1005px;overflow:hidden;';
  inner.appendChild(fit);
  page.appendChild(inner);
  var foot = document.createElement('div');
  foot.style.cssText = 'position:absolute;left:40px;right:40px;bottom:26px;border-top:1px solid #E2E8F0;padding-top:8px;display:flex;justify-content:space-between;font-size:10px;color:#64748B';
  foot.innerHTML = '<span>FicheProBot — l’éducation autrement</span><span id="ee-pg" style="min-width:70px;text-align:center;font-weight:700"></span><span>Cahier d’expression écrite · '+esc(c)+'</span>';
  page.appendChild(foot);
  page._fit = fit; page._avail = 1005;
  return page;
}
/* Rend UNE page A4 (794 x 1123 px) en image nette puis la place plein cadre dans un PDF A4.
   Chaque page est capturée seule dans #pdf-root (hors écran) : plus aucune découpe automatique en travers d'une ligne. */
async function a4Page(pageEl, pdf, first){
  var root = document.getElementById('pdf-root');
  if(!root){ root = document.createElement('div'); root.id = 'pdf-root'; document.body.appendChild(root); }
  root.innerHTML = ''; root.appendChild(pageEl);
  if(typeof waitForImages === 'function') await waitForImages(root);
  var canvas = await html2pdf().set({ html2canvas:{ scale:3.5, useCORS:true, letterRendering:true, backgroundColor:'#ffffff', scrollX:0, scrollY:0 } })
    .from(pageEl).toCanvas().get('canvas');
  if(!first) pdf.addPage();
  var data = null, fmt = 'PNG';
  try{ data = canvas.toDataURL('image/png'); }catch(e){ data = null; }
  if(!data || data.length > 4500000){ data = canvas.toDataURL('image/jpeg', 0.97); fmt = 'JPEG'; }
  pdf.addImage(data, fmt, 0, 0, 210, 297, undefined, 'FAST');
  root.innerHTML = '';
}
async function newA4Pdf(){
  return await html2pdf().set({ jsPDF:{ unit:'mm', format:'a4', orientation:'portrait', compress:true } }).from(document.createElement('div')).toPdf().get('pdf');
}
/* Réduit le contenu s'il dépasse la hauteur disponible (rien n'est jamais coupé). */
function fitInto(fitEl, availH){
  var h = fitEl.scrollHeight;
  if(h > availH){
    var s = availH / h;
    fitEl.style.transform = 'scale('+s.toFixed(4)+')'; fitEl.style.transformOrigin = 'top left'; fitEl.style.width = (100/s).toFixed(2)+'%';
    fitEl.style.height = availH/s + 'px';
  }
}

/* Année scolaire courante (de septembre à août). */
function anneeScolaire(){
  var d = new Date(), y = d.getFullYear();
  return d.getMonth() >= 7 ? (y+'-'+(y+1)) : ((y-1)+'-'+y);
}
/* Page de garde du cahier. */
function buildCover(c, n){
  var NAVY = '#16327A', BLUE = '#2563EB', INK = '#0F172A', SOFT = '#475569';
  var page = document.createElement('div');
  page.style.cssText = "position:relative;width:794px;height:1123px;box-sizing:border-box;overflow:hidden;background:#fff;font-family:'Inter','Poppins',Arial,sans-serif;color:"+INK+";";
  var line = function(label, val){
    return '<div style="display:flex;align-items:flex-end;margin-top:30px;font-size:17px;font-weight:700;color:'+INK+'"><span style="white-space:nowrap">'+label+' :&nbsp;</span>'
      + (val ? '<span style="flex:1;border-bottom:1.5px dotted #64748B;font-weight:800;color:'+NAVY+';padding-bottom:1px">'+esc(val)+'</span>' : '<span style="flex:1;height:26px;border-bottom:1.5px dotted #64748B"></span>') + '</div>';
  };
  page.innerHTML = ''
    + '<div style="position:absolute;left:0;right:0;top:0;height:16px;background:linear-gradient(100deg,'+NAVY+',#2B5BE0)"></div>'
    + '<div style="position:absolute;left:56px;right:56px;top:56px;display:flex;justify-content:space-between;align-items:center">'
    +   '<div style="display:flex;align-items:center"><span style="display:inline-block;width:12px;height:12px;border-radius:50%;background:#F59E0B;margin-right:9px"></span><span style="font-weight:800;font-size:18px;color:'+NAVY+'">FicheProBot</span></div>'
    +   '<div style="font-size:13px;font-weight:600;color:'+SOFT+'">Cahier de l’élève</div></div>'
    + '<div style="position:absolute;left:56px;right:56px;top:210px;background:linear-gradient(100deg,'+NAVY+',#2B5BE0);border-radius:22px;padding:56px 30px;color:#fff;text-align:center">'
    +   '<div style="font-size:15px;font-weight:700;letter-spacing:3px;opacity:.85">CAHIER</div>'
    +   '<div style="font-size:40px;font-weight:800;letter-spacing:.5px;line-height:1.2;margin-top:10px">D’EXPRESSION<br>ÉCRITE</div>'
    +   '<div style="display:inline-block;background:rgba(255,255,255,.2);border-radius:30px;padding:6px 26px;font-size:20px;font-weight:800;margin-top:24px">Classe : '+esc(c)+'</div></div>'
    + '<div style="position:absolute;left:96px;right:96px;top:560px">'
    +   line('Année scolaire', anneeScolaire())
    +   line('École', '')
    +   line('Enseignant(e)', '')
    +   (n ? line('Effectif', String(n)+' élève'+(n>1?'s':'')) : '')
    + '</div>'
    + '<div style="position:absolute;left:56px;right:56px;bottom:40px;border-top:1px solid #E2E8F0;padding-top:9px;display:flex;justify-content:space-between;font-size:10.5px;color:#64748B"><span>FicheProBot — l’éducation autrement</span><span>Cahier d’expression écrite · '+esc(c)+'</span></div>';
  return page;
}

/* Capture UNE page en image et mesure la position des zones « nom » et « numéro » (en mm sur la feuille A4). */
async function capture(pageEl, ids){
  var root = document.getElementById('pdf-root');
  if(!root){ root = document.createElement('div'); root.id = 'pdf-root'; document.body.appendChild(root); }
  root.innerHTML = ''; root.appendChild(pageEl);
  if(typeof waitForImages === 'function') await waitForImages(root);
  var pr = pageEl.getBoundingClientRect(), k = 210 / pr.width, zones = {};
  (ids || []).forEach(function(id){
    var el = pageEl.querySelector('#'+id); if(!el) return;
    var r = el.getBoundingClientRect();
    zones[id] = { x:(r.left-pr.left)*k, y:(r.top-pr.top)*k, w:r.width*k, h:r.height*k };
  });
  var canvas = await html2pdf().set({ html2canvas:{ scale:3.5, useCORS:true, letterRendering:true, backgroundColor:'#ffffff', scrollX:0, scrollY:0 } })
    .from(pageEl).toCanvas().get('canvas');
  var data = null, fmt = 'PNG';
  try{ data = canvas.toDataURL('image/png'); }catch(e){ data = null; }
  if(!data || data.length > 4500000){ data = canvas.toDataURL('image/jpeg', 0.97); fmt = 'JPEG'; }
  root.innerHTML = '';
  return { data:data, fmt:fmt, zones:zones };
}
/* jsPDF (polices standard) : on remplace les caractères hors Latin-1/WinAnsi qui s'afficheraient mal. */
function pdfSafe(t){
  return String(t||'').replace(/[\u2018\u2019\u02BC]/g, "'").replace(/[\u201C\u201D]/g, '"').replace(/[\u2013\u2014]/g, '-').replace(/\u00A0/g, ' ');
}

async function pdf(){
  var c = S.classe; errMsg = '';
  if(!c){ errMsg = 'Choisis d\u2019abord ta classe.'; renderExpression(); return; }
  if(typeof html2pdf === 'undefined'){ alert("Le module PDF n'est pas encore chargé. Vérifie ta connexion puis réessaie."); return; }
  var filename = 'Cahier_expression_ecrite_'+c+'.pdf';
  var eleves = liste(c).slice(), nb = eleves.length;
  try{
    dlProgressStart('Création de ton PDF', 'Mise en page du cahier…');
    var n = total(blocks(c));
    var doc = await newA4Pdf();
    var root = document.getElementById('pdf-root') || document.body.appendChild(Object.assign(document.createElement('div'), { id:'pdf-root' }));

    /* 1) Page de garde */
    var cov = await capture(buildCover(c, nb));
    doc.addImage(cov.data, cov.fmt, 0, 0, 210, 297, undefined, 'FAST');

    /* 2) Page modèle (tableau) : hauteur des lignes calculée pour remplir la feuille, rendue UNE seule fois. */
    var rowH = 40, page = buildPdf(c, rowH);
    root.innerHTML = ''; root.appendChild(page);
    var free = page._avail - page._fit.scrollHeight;
    if(free > 0){
      rowH = Math.max(40, Math.min(110, rowH + Math.floor(free / Math.max(n, 1)) - 1));
      page = buildPdf(c, rowH);
      root.innerHTML = ''; root.appendChild(page);
    }
    fitInto(page._fit, page._avail);
    var tpl = await capture(page, ['ee-name', 'ee-pg']);

    /* 3) Une page par élève : image du modèle (partagée, une seule fois dans le fichier) + nom + numéro de page. */
    var list = nb ? eleves : [''];
    list.forEach(function(nom, i){
      doc.addPage();
      doc.addImage(tpl.data, tpl.fmt, 0, 0, 210, 297, 'ee-modele-'+c, 'FAST');
      var z = tpl.zones['ee-name'], g = tpl.zones['ee-pg'];
      if(nom && z){
        var t = pdfSafe(nom), fs = 14;
        doc.setFont('helvetica', 'bold'); doc.setTextColor(15, 23, 42);
        doc.setFontSize(fs);
        while(fs > 8 && doc.getTextWidth(t) > z.w - 3){ fs -= 0.5; doc.setFontSize(fs); }
        doc.text(t, z.x + 1.5, z.y + z.h - 1.6);
      }
      if(g){
        doc.setFont('helvetica', 'bold'); doc.setFontSize(9.5); doc.setTextColor(71, 85, 105);
        doc.text('Page ' + (i + 1), g.x + g.w / 2, g.y + g.h - 0.6, { align:'center' });
      }
    });
    downloadPdfBlob(doc.output('blob'), filename);
  }catch(err){
    console.error(err);
    try{ dlProgressDone(); }catch(_){}
    alert('Impossible de créer le PDF. Réessaie.');
  }
}

window.EE = {
  classe: function(c){ S.classe = c; errMsg = ''; save(); renderExpression(); },
  file: function(inp){ var f = inp && inp.files && inp.files[0]; if(f) importFile(f); if(inp) inp.value = ''; },
  text: function(v){
    var c = S.classe; if(!c) return;
    var a = String(v||'').split('\n').map(cleanName).filter(Boolean);
    S.eleves[c] = a; save();
    var el = document.getElementById('ee-count'); if(el) el.innerHTML = countText(c);
  },
  clear: function(){ var c = S.classe; if(!c) return; S.eleves[c] = []; errMsg = ''; save(); renderExpression(); },
  pdf: pdf,
  _blocks: blocks, _build: buildPdf
};
})();

/*
  CARTE « EXPRESSION ÉCRITE » (accueil) — classes CE1 à CM2.

  L'enseignant choisit la classe puis télécharge en PDF (A4) le CAHIER D'EXPRESSION ÉCRITE à faire photocopier pour les élèves :
      Expression écrite | Unité | Types d'incorrections (Gram. · Orth. · Conj. · Syntaxe · Autres) | Appréciation de l'enseignant | Note
  Chaque type de texte (Affiche, Lettre familière, Description, Carte d'invitation, Récit, Lettre administrative, Article de journal)
  occupe autant de lignes que de textes prévus dans la classe. Les autres textes du programme (compte rendu, règles de jeu…)
  sont ajoutés à la suite, chacun sur sa ligne avec son nom exact. Un type absent du programme de la classe n'apparaît pas.

  Les textes viennent du projet de planification (rubrique « expression écrite » de chaque unité, 12 unités par classe) :
  le type de texte de chaque unité est fixé dans EE_PLAN ci-dessous (clé = numéro d'unité).

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

var S = { classe:'', loaded:false };
var errMsg = '';

function esc(x){ return (typeof escapeHtml === 'function') ? escapeHtml(String(x==null?'':x)) : String(x==null?'':x).replace(/[&<>"]/g,function(c){ return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]; }); }

function load(){
  if(S.loaded) return; S.loaded = true;
  try{ var o = JSON.parse(localStorage.getItem(LS_KEY) || '{}') || {}; if(o.classe && CLASSES.indexOf(o.classe) >= 0) S.classe = o.classe; }catch(e){}
}
function save(){ try{ localStorage.setItem(LS_KEY, JSON.stringify({ classe:S.classe })); }catch(e){} }

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
      + (errMsg ? '<div class="ee-err">'+esc(errMsg)+'</div>' : '')
      + '<button type="button" class="ee-go" onclick="EE.pdf()">Télécharger le cahier en PDF</button>'
      + '<p class="ee-note" style="text-align:center">Une page A4, à photocopier : chaque élève écrit son nom en haut.</p>';
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
    + '<div style="margin:14px 2px;font-size:14px;font-weight:700;white-space:nowrap;overflow:hidden;color:'+INK+'">NOM et Prénoms : <span style="font-weight:400;letter-spacing:1px;color:#64748B">........................................................................................</span></div>'
    + '<table style="width:704px;border-collapse:collapse;table-layout:fixed;border:'+B+'">'+cols+head+body+'</table>'
    + '<div style="font-size:10.5px;color:'+SOFT+';margin-top:7px">U = unité du projet de planification du '+esc(c)+' (un texte par unité).</div>';
  var inner = document.createElement('div');
  inner.style.cssText = 'position:absolute;left:40px;right:40px;top:34px;height:1005px;overflow:hidden;';
  inner.appendChild(fit);
  page.appendChild(inner);
  var foot = document.createElement('div');
  foot.style.cssText = 'position:absolute;left:40px;right:40px;bottom:26px;border-top:1px solid #E2E8F0;padding-top:8px;display:flex;justify-content:space-between;font-size:10px;color:#64748B';
  foot.innerHTML = '<span>FicheProBot — l’éducation autrement</span><span>Cahier d’expression écrite · '+esc(c)+'</span>';
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

async function pdf(){
  var c = S.classe; errMsg = '';
  if(!c){ errMsg = 'Choisis d\u2019abord ta classe.'; renderExpression(); return; }
  if(typeof html2pdf === 'undefined'){ alert("Le module PDF n'est pas encore chargé. Vérifie ta connexion puis réessaie."); return; }
  var filename = 'Cahier_expression_ecrite_'+c+'.pdf';
  try{
    dlProgressStart('Création de ton PDF', 'Mise en page du cahier…');
    var n = total(blocks(c));
    var doc = await newA4Pdf();
    var root = document.getElementById('pdf-root') || document.body.appendChild(Object.assign(document.createElement('div'), { id:'pdf-root' }));
    /* Hauteur des lignes : on mesure la page avec des lignes minimales, puis on répartit l'espace libre pour remplir la feuille. */
    var rowH = 40, page = buildPdf(c, rowH);
    root.innerHTML = ''; root.appendChild(page);
    var free = page._avail - page._fit.scrollHeight;
    if(free > 0){
      rowH = Math.max(40, Math.min(110, rowH + Math.floor(free / Math.max(n, 1)) - 1));
      page = buildPdf(c, rowH);
      root.innerHTML = ''; root.appendChild(page);
    }
    fitInto(page._fit, page._avail);
    await a4Page(page, doc, true);
    downloadPdfBlob(doc.output('blob'), filename);
  }catch(err){
    console.error(err);
    try{ dlProgressDone(); }catch(_){}
    alert('Impossible de créer le PDF. Réessaie.');
  }
}

window.EE = {
  classe: function(c){ S.classe = c; errMsg = ''; save(); renderExpression(); },
  pdf: pdf,
  _blocks: blocks, _build: buildPdf
};
})();

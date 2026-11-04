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
function buildPdf(c){
  var bl = blocks(c), n = total(bl);
  var W = 720;
  var rowH = Math.max(50, Math.min(118, Math.floor(790 / Math.max(n, 1))));
  var el = document.createElement('div');
  el.style.cssText = "width:"+W+"px;font-family:'Inter','Poppins',Arial,sans-serif;color:#0F172A;background:#fff;";
  var B = '1.3px solid #1E293B', b = 'border:'+B+';';
  var th = b+'background:#EEF2F7;font-weight:700;font-size:12.5px;text-align:center;padding:6px 3px;';
  var cols = '<colgroup><col style="width:122px"><col style="width:46px"><col style="width:62px"><col style="width:62px"><col style="width:62px"><col style="width:66px"><col style="width:62px"><col style="width:170px"><col style="width:68px"></colgroup>';
  var head = '<tr><th rowspan="2" colspan="2" style="'+th+'font-size:14px">Expression écrite</th><th colspan="5" style="'+th+'font-size:14px">Types d\u2019incorrections</th><th colspan="2" style="'+th+'font-size:13px">Appréciation de l\u2019enseignant</th></tr>'
    + '<tr><th style="'+th+'">Gram.</th><th style="'+th+'">Orth.</th><th style="'+th+'">Conj.</th><th style="'+th+'">Syntaxe</th><th style="'+th+'">Autres</th><th style="'+th+'">Appréciation</th><th style="'+th+'">Note</th></tr>';
  var empty = '';
  for(var i=0;i<7;i++) empty += '<td style="'+b+'"></td>';
  var body = '';
  bl.forEach(function(blk){
    blk.rows.forEach(function(r, i){
      var first = '';
      if(blk.other) first = '<td style="'+b+'padding:4px 6px;font-weight:700;font-size:12px;line-height:1.2;vertical-align:middle">'+esc(r.label)+'</td>';
      else if(i === 0) first = '<td rowspan="'+blk.rows.length+'" style="'+b+'padding:4px 6px;font-weight:800;font-size:14px;line-height:1.2;vertical-align:middle">'+esc(blk.nom)+'</td>';
      /* bloc « Autres textes » : un séparateur d'intitulé sur la première ligne */
      var unit = '<td style="'+b+'text-align:center;font-size:11px;font-weight:700;color:#475569;vertical-align:middle">U'+r.u+'</td>';
      body += '<tr style="height:'+rowH+'px;page-break-inside:avoid">'+first+unit+empty+'</tr>';
    });
  });
  el.innerHTML = ''
    + '<div style="text-align:center;font-weight:800;font-size:19px;letter-spacing:.5px;border-bottom:2px solid #1E293B;padding-bottom:6px">CAHIER D\u2019EXPRESSION ÉCRITE — '+esc(c)+'</div>'
    + '<div style="margin:14px 2px 14px;font-size:14px;font-weight:700;white-space:nowrap;overflow:hidden">NOM et Prénoms : <span style="font-weight:400;letter-spacing:1px">.....................................................................................</span></div>'
    + '<table style="width:100%;border-collapse:collapse;table-layout:fixed;border:'+B+'">'+cols+head+body+'</table>'
    + '<div style="font-size:10.5px;color:#64748B;margin-top:6px">U = unité du projet de planification du '+esc(c)+' (un texte par unité).</div>';
  return el;
}

async function pdf(){
  var c = S.classe; errMsg = '';
  if(!c){ errMsg = 'Choisis d\u2019abord ta classe.'; renderExpression(); return; }
  if(typeof html2pdf === 'undefined'){ alert("Le module PDF n'est pas encore chargé. Vérifie ta connexion puis réessaie."); return; }
  var filename = 'Cahier_expression_ecrite_'+c+'.pdf';
  try{
    dlProgressStart('Création de ton PDF', 'Mise en page du cahier…');
    var el = buildPdf(c);
    var opt = { margin:[14,12,16,12], filename:filename, image:{ type:'jpeg', quality:0.97 }, html2canvas:{ scale:2, backgroundColor:'#ffffff', scrollX:0, scrollY:0 },
      jsPDF:{ unit:'mm', format:'a4', orientation:'portrait' }, pagebreak:{ mode:['css','legacy'] } };
    var doc = await html2pdf().set(opt).from(el).toPdf().get('pdf');
    var tot = doc.internal.getNumberOfPages(), pw = doc.internal.pageSize.getWidth(), ph = doc.internal.pageSize.getHeight();
    for(var i=1;i<=tot;i++){
      doc.setPage(i);
      doc.setFont('helvetica','normal'); doc.setFontSize(8); doc.setTextColor(100,116,139);
      doc.text('FicheProBot — Cahier d\u2019expression écrite · '+c, 12, ph-8);
      if(tot > 1) doc.text('Page '+i+' / '+tot, pw-12, ph-8, { align:'right' });
    }
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

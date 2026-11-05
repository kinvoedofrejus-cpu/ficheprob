/*
  CARTE « STATISTIQUES DE CLASSE » (accueil) — deux sous-cartes :
    1) Statistiques d'évaluation   : inscrits, seuil, ont composé, ont atteint le seuil (garçons / filles / total),
                                     pourcentages calculés par l'application, N'ont pas atteint = ont composé − ont atteint.
    2) Statistiques de fin du mois : mois (liste), inscrits, nombre de demi-journées, absences ;
                                     l'application calcule présence possible (effectif × demi-journées), % d'absence,
                                     présence effective (possible − absences) et % de présence.
  Chaque fiche est un tableau suivi de « Je certifie exacts les renseignements ci-dessus », avec le Directeur à gauche
  et l'enseignant(e) à droite. Le PDF est en A4 portrait, la fiche occupant la MOITIÉ SUPÉRIEURE de la feuille (= A5 paysage
  une fois la feuille coupée en deux). Les pourcentages d'évaluation sont calculés sur les élèves qui ont composé.

  Dépend de index.html : state, render, escapeHtml, downloadPdfBlob, dlProgressStart, dlProgressDone, html2pdf, homeRow,
  waitForImages (facultatif), getSession (facultatif).
*/
(function(){
'use strict';

var LS_KEY = 'fpb_stats_classe_v1';
var CLASSES = ['CI','CP','CE1','CE2','CM1','CM2'];
var MOIS = ['Septembre','Octobre','Novembre','Décembre','Janvier','Février','Mars','Avril','Mai','Juin','Juillet'];
var TYPES_EVAL = ['Évaluation diagnostique','Évaluation formative','Évaluation sommative','Évaluation de séquence','Composition trimestrielle','Évaluation de fin de période'];

var S = { loaded:false,
  info:{ ecole:'', circ:'', classe:'', directeur:'', enseignant:'' },
  ev:{ type:'', seuil:'', sur:'', ins:['',''], comp:['',''], att:['',''] },
  mo:{ mois:'', dj:'', ins:['',''], abs:['',''] } };
var errMsg = '';

function esc(x){ return (typeof escapeHtml === 'function') ? escapeHtml(String(x==null?'':x)) : String(x==null?'':x).replace(/[&<>"]/g,function(c){ return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]; }); }
function clean(x){ return String(x == null ? '' : x).replace(/\s+/g,' ').trim(); }
function num(v){ var n = parseInt(String(v == null ? '' : v).replace(/[^\d]/g,''), 10); return isNaN(n) ? 0 : n; }
function filled(v){ return String(v == null ? '' : v).trim() !== ''; }

/* ------------------------------------------------------------------ */
/* Sauvegarde locale                                                    */
/* ------------------------------------------------------------------ */
function load(){
  if(S.loaded) return; S.loaded = true;
  try{
    var o = JSON.parse(localStorage.getItem(LS_KEY) || '{}') || {};
    ['info','ev','mo'].forEach(function(k){
      if(o[k] && typeof o[k] === 'object') Object.keys(S[k]).forEach(function(f){
        if(Array.isArray(S[k][f])){ if(Array.isArray(o[k][f])) S[k][f] = [String(o[k][f][0]||''), String(o[k][f][1]||'')]; }
        else if(typeof o[k][f] === 'string') S[k][f] = o[k][f];
      });
    });
  }catch(e){}
  /* Pré-remplissage depuis la carte « Liste de la classe » et la session. */
  try{
    var l = JSON.parse(localStorage.getItem('fpb_liste_classe_v1') || '{}') || {};
    if(!S.info.ecole && l.ecole) S.info.ecole = l.ecole;
    if(!S.info.circ && l.circ) S.info.circ = l.circ;
    if(!S.info.classe && l.classe) S.info.classe = l.classe;
    if(!S.info.directeur && l.directeur) S.info.directeur = l.directeur;
    if(!S.info.enseignant && l.enseignant) S.info.enseignant = l.enseignant;
  }catch(e){}
  if(!S.info.enseignant){
    try{
      var se = (typeof getSession === 'function') ? getSession() : null;
      if(se){ var nm = clean((se.prenom||'') + ' ' + (se.nom||'')); if(nm) S.info.enseignant = nm; }
    }catch(e){}
  }
}
function save(){ try{ localStorage.setItem(LS_KEY, JSON.stringify({ info:S.info, ev:S.ev, mo:S.mo })); }catch(e){} }

/* ------------------------------------------------------------------ */
/* Calculs                                                              */
/* ------------------------------------------------------------------ */
function pct(x, t){ return t > 0 ? (x * 100 / t).toFixed(1).replace(/\.0$/, '').replace('.', ',') + ' %' : '—'; }
function tri(a){ var g = num(a[0]), f = num(a[1]); return [g, f, g + f]; }

/* Lignes du tableau d'évaluation : { l:libellé, v:[G,F,T], pc:bool, b:gras } */
function evalRows(){
  var e = S.ev, ins = tri(e.ins), comp = tri(e.comp), att = tri(e.att);
  var non = [Math.max(0, comp[0] - att[0]), Math.max(0, comp[1] - att[1]), 0]; non[2] = non[0] + non[1];
  var P = function(a, b){ return [pct(a[0], b[0]), pct(a[1], b[1]), pct(a[2], b[2])]; };
  return [
    { l:'Inscrits', v:ins },
    { l:'Ont composé', v:comp },
    { l:'Ont atteint le seuil', v:att },
    { l:'% ayant atteint le seuil', v:P(att, comp), pc:true },
    { l:'N’ont pas atteint le seuil', v:non },
    { l:'% n’ayant pas atteint le seuil', v:P(non, comp), pc:true }
  ];
}
function moisRows(){
  var m = S.mo, dj = num(m.dj), ins = tri(m.ins), abs = tri(m.abs);
  var poss = [ins[0] * dj, ins[1] * dj, 0]; poss[2] = poss[0] + poss[1];
  var eff = [Math.max(0, poss[0] - abs[0]), Math.max(0, poss[1] - abs[1]), 0]; eff[2] = eff[0] + eff[1];
  var P = function(a, b){ return [pct(a[0], b[0]), pct(a[1], b[1]), pct(a[2], b[2])]; };
  return [
    { l:'Inscrits', v:ins },
    { l:'Présence possible', v:poss },
    { l:'Absences', v:abs },
    { l:'% d’absence', v:P(abs, poss), pc:true },
    { l:'Présence effective', v:eff },
    { l:'% de présence effective', v:P(eff, poss), pc:true }
  ];
}

/* ------------------------------------------------------------------ */
/* Style et écrans                                                      */
/* ------------------------------------------------------------------ */
function ensureStyle(){
  if(document.getElementById('sc-style')) return;
  var st = document.createElement('style'); st.id = 'sc-style';
  st.textContent = ''
    + '.sc-box{background:#fff;border:1px solid var(--line,#E3E8EF);border-radius:14px;padding:12px;margin:0 0 12px}'
    + '.sc-tt{font-family:Poppins,sans-serif;font-weight:800;font-size:13px;color:var(--blue,#0A6FD8);margin:0 0 8px}'
    + '.sc-lb{display:block;font-size:12px;font-weight:700;color:var(--ink-soft,#5B6577);margin:9px 0 4px}'
    + '.sc-tt + .sc-lb{margin-top:0}'
    + '.sc-in{width:100%;box-sizing:border-box;border:1.5px solid var(--line,#E3E8EF);border-radius:10px;padding:10px;font-size:14px;font-family:inherit;color:var(--ink,#1B2740);background:#fff}'
    + '.sc-in:focus{outline:none;border-color:var(--blue,#0A6FD8)}'
    + '.sc-two{display:grid;grid-template-columns:1fr 1fr;gap:8px}'
    + '.sc-grid{display:grid;grid-template-columns:1.1fr 1fr 1fr;gap:8px;align-items:center;margin-top:6px}'
    + '.sc-grid .h{font-size:11.5px;font-weight:800;text-align:center;color:#1E3A8A}.sc-grid .h.f{color:#D81B1B}'
    + '.sc-grid .r{font-size:13px;font-weight:700;color:var(--ink,#1B2740)}'
    + '.sc-grid .sc-in{text-align:center;padding:9px 4px}'
    + '.sc-note{font-size:12px;color:var(--ink-soft,#5B6577);margin:6px 0 0;line-height:1.4}'
    + '.sc-go{width:100%;margin:6px 0 0;border:none;background:var(--blue,#0A6FD8);color:#fff;border-radius:12px;padding:13px;font-weight:800;font-size:14px;cursor:pointer;touch-action:manipulation}'
    + '.sc-err{font-size:12.5px;color:#B3261E;background:#FDECEA;border-radius:8px;padding:8px 10px;margin:8px 0 0}'
    + '.sc-tbl{width:100%;border-collapse:collapse;font-size:12.5px}'
    + '.sc-tbl th{background:#1E3A8A;color:#fff;padding:6px 4px;border:1px solid #1E3A8A}'
    + '.sc-tbl td{padding:6px 4px;border:1px solid #CBD5E1;text-align:center;font-weight:700}'
    + '.sc-tbl td:first-child{text-align:left}.sc-tbl tr.pc td{background:#EEF2FF;color:#1E3A8A}';
  document.head.appendChild(st);
}

window.openStatsClasse = function(){ load(); state = { view:'statsHub' }; render(); window.scrollTo(0,0); };
window.openStatsEval = function(){ load(); errMsg = ''; state = { view:'statsEval' }; render(); window.scrollTo(0,0); };
window.openStatsMois = function(){ load(); errMsg = ''; state = { view:'statsMois' }; render(); window.scrollTo(0,0); };

function head(eyebrow, h1, back, intro){
  return '<button class="backbtn" onclick="'+back+'">← Retour</button>'
    + '<div class="masthead" style="border-bottom:none;margin-bottom:10px"><div><span class="eyebrow">'+eyebrow+'</span><h1>'+h1+'</h1></div></div>'
    + (intro ? '<p class="sc-note" style="margin:0 0 12px">'+intro+'</p>' : '');
}
function renderStatsHub(){
  ensureStyle();
  var vp = document.getElementById('viewport'); if(!vp) return;
  var ic = (typeof ROW_ICONS !== 'undefined' && ROW_ICONS.checkSquare) ? ROW_ICONS.checkSquare : '';
  var ic2 = (typeof ROW_ICONS !== 'undefined' && ROW_ICONS.doc) ? ROW_ICONS.doc : '';
  vp.innerHTML = head('Documents de classe', 'Statistiques <em>de classe</em>', "state={view:'list'}; render();", 'Choisis la fiche à remplir. L’application calcule les totaux et les pourcentages, puis te donne un PDF prêt à signer.')
    + '<div class="home-col">'
    + homeRow('violet', ic, 'Statistiques d’évaluation', 'Seuil, réussite, pourcentages', "openStatsEval()")
    + homeRow('sage', ic2, 'Statistiques de fin du mois', 'Présences, absences, pourcentages', "openStatsMois()")
    + '</div>';
}
window.renderStatsHub = renderStatsHub;

function infoBox(){
  var i = S.info;
  var dl = '<datalist id="sc-cl">' + CLASSES.map(function(c){ return '<option value="'+c+'">'; }).join('') + '</datalist>';
  return '<div class="sc-box"><div class="sc-tt">1. Informations</div>'
    + '<label class="sc-lb" for="sc-ecole">Nom de l’école *</label><input id="sc-ecole" class="sc-in" value="'+esc(i.ecole)+'" placeholder="Ex. EPP Adjarra-Centre" oninput="SC.info(\'ecole\',this.value)">'
    + '<label class="sc-lb" for="sc-circ">Circonscription scolaire *</label><input id="sc-circ" class="sc-in" value="'+esc(i.circ)+'" placeholder="Ex. Adjarra" oninput="SC.info(\'circ\',this.value)">'
    + '<label class="sc-lb" for="sc-classe">Classe *</label><input id="sc-classe" class="sc-in" list="sc-cl" value="'+esc(i.classe)+'" placeholder="Ex. CM1" oninput="SC.info(\'classe\',this.value)">'+dl
    + '<div class="sc-two"><div><label class="sc-lb" for="sc-dir">Directeur / Directrice</label><input id="sc-dir" class="sc-in" value="'+esc(i.directeur)+'" oninput="SC.info(\'directeur\',this.value)"></div>'
    + '<div><label class="sc-lb" for="sc-ens">Enseignant(e)</label><input id="sc-ens" class="sc-in" value="'+esc(i.enseignant)+'" oninput="SC.info(\'enseignant\',this.value)"></div></div>'
    + '<p class="sc-note">Les noms du Directeur et de l’enseignant sont facultatifs : sans nom, la place reste libre pour écrire à la main.</p></div>';
}
function numRow(kind, key, label){
  var a = S[kind][key];
  var mk = function(i){ return '<input class="sc-in" type="number" inputmode="numeric" min="0" value="'+esc(a[i])+'" oninput="SC.n(\''+kind+'\',\''+key+'\','+i+',this.value)">'; };
  return '<div class="r">'+label+'</div>'+mk(0)+mk(1);
}
function previewHtml(kind){
  var rows = kind === 'ev' ? evalRows() : moisRows();
  return '<table class="sc-tbl"><tr><th></th><th>Garçons</th><th style="background:#D81B1B;border-color:#D81B1B">Filles</th><th>Total</th></tr>'
    + rows.map(function(r){ return '<tr class="'+(r.pc?'pc':'')+'"><td>'+r.l+'</td><td>'+cellv(r.v[0], r.pc)+'</td><td>'+cellv(r.v[1], r.pc)+'</td><td>'+cellv(r.v[2], r.pc)+'</td></tr>'; }).join('') + '</table>';
}
function cellv(v, pc){ return pc ? v : String(v); }
function refreshPrev(kind){ var p = document.getElementById('sc-prev'); if(p) p.innerHTML = previewHtml(kind); }
function gridHead(){ return '<div></div><div class="h">Garçons</div><div class="h f">Filles</div>'; }

function renderStatsEval(){
  ensureStyle(); load();
  var vp = document.getElementById('viewport'); if(!vp) return;
  var e = S.ev;
  var dl = '<datalist id="sc-ty">' + TYPES_EVAL.map(function(t){ return '<option value="'+esc(t)+'">'; }).join('') + '</datalist>';
  vp.innerHTML = head('Statistiques de classe', 'Statistiques <em>d’évaluation</em>', "state={view:'statsHub'}; render();", 'Renseigne les effectifs : le total, les pourcentages et les élèves qui n’ont pas atteint le seuil sont calculés automatiquement.')
    + infoBox()
    + '<div class="sc-box"><div class="sc-tt">2. Évaluation</div>'
    +   '<label class="sc-lb" for="sc-type">Type d’évaluation *</label><input id="sc-type" class="sc-in" list="sc-ty" value="'+esc(e.type)+'" placeholder="Ex. Évaluation sommative — Français" oninput="SC.ev(\'type\',this.value)">'+dl
    +   '<label class="sc-lb">Seuil *</label><div class="sc-two" style="align-items:center;grid-template-columns:1fr auto 1fr"><input class="sc-in" type="number" inputmode="decimal" step="any" min="0" value="'+esc(e.seuil)+'" placeholder="Ex. 10" oninput="SC.ev(\'seuil\',this.value)"><b>/</b><input class="sc-in" type="number" inputmode="decimal" step="any" min="0" value="'+esc(e.sur)+'" placeholder="Ex. 20" oninput="SC.ev(\'sur\',this.value)"></div>'
    +   '<div class="sc-grid">'+gridHead()+numRow('ev','ins','Inscrits')+numRow('ev','comp','Ont composé')+numRow('ev','att','Ont atteint le seuil')+'</div>'
    + '</div>'
    + '<div class="sc-box"><div class="sc-tt">3. Aperçu du tableau</div><div id="sc-prev">'+previewHtml('ev')+'</div>'
    +   '<p class="sc-note">Les pourcentages sont calculés sur les élèves qui ont composé.</p></div>'
    + (errMsg ? '<div class="sc-err">'+esc(errMsg)+'</div>' : '')
    + '<button type="button" class="sc-go" onclick="SC.pdf(\'ev\')">Télécharger en PDF</button><div style="height:16px"></div>';
}
window.renderStatsEval = renderStatsEval;

function renderStatsMois(){
  ensureStyle(); load();
  var vp = document.getElementById('viewport'); if(!vp) return;
  var m = S.mo;
  var opts = '<option value="">— Choisir le mois —</option>' + MOIS.map(function(x){ return '<option'+(m.mois===x?' selected':'')+'>'+x+'</option>'; }).join('');
  vp.innerHTML = head('Statistiques de classe', 'Statistiques <em>de fin du mois</em>', "state={view:'statsHub'}; render();", 'Renseigne les inscrits, le nombre de demi-journées et les absences : la présence possible, la présence effective et les pourcentages sont calculés automatiquement.')
    + infoBox()
    + '<div class="sc-box"><div class="sc-tt">2. Mois</div>'
    +   '<label class="sc-lb" for="sc-mois">Mois *</label><select id="sc-mois" class="sc-in" onchange="SC.mo(\'mois\',this.value)">'+opts+'</select>'
    +   '<label class="sc-lb" for="sc-dj">Nombre de demi-journées du mois *</label><input id="sc-dj" class="sc-in" type="number" inputmode="numeric" min="0" value="'+esc(m.dj)+'" placeholder="Ex. 40" oninput="SC.mo(\'dj\',this.value)">'
    +   '<div class="sc-grid">'+gridHead()+numRow('mo','ins','Inscrits')+numRow('mo','abs','Absences')+'</div>'
    +   '<p class="sc-note">Absences = total des demi-journées d’absence des garçons, puis des filles.</p>'
    + '</div>'
    + '<div class="sc-box"><div class="sc-tt">3. Aperçu du tableau</div><div id="sc-prev">'+previewHtml('mo')+'</div>'
    +   '<p class="sc-note">Présence possible = effectif × nombre de demi-journées. Présence effective = présence possible − absences.</p></div>'
    + (errMsg ? '<div class="sc-err">'+esc(errMsg)+'</div>' : '')
    + '<button type="button" class="sc-go" onclick="SC.pdf(\'mo\')">Télécharger en PDF</button><div style="height:16px"></div>';
}
window.renderStatsMois = renderStatsMois;

/* ------------------------------------------------------------------ */
/* PDF : fiche dans la moitié supérieure d'une page A4                  */
/* ------------------------------------------------------------------ */
var NAVY = '#16327A', INK = '#0F172A', SOFT = '#475569', RED = '#D81B1B';
function anneeScolaire(){ var d = new Date(), y = d.getFullYear(); return d.getMonth() >= 7 ? (y+'-'+(y+1)) : ((y-1)+'-'+y); }

function infoLine(label, val, flex){
  return '<div style="display:flex;align-items:flex-end;flex:'+(flex||1)+';min-width:0;font-size:13px;font-weight:700;color:'+INK+'"><span style="white-space:nowrap">'+label+' :&nbsp;</span>'
    + '<span style="flex:1;min-width:0;border-bottom:1.5px dotted #64748B;font-weight:800;color:'+NAVY+';padding:0 4px 1px;white-space:nowrap;overflow:hidden">'+esc(val)+'</span></div>';
}
function buildPage(kind){
  var i = S.info, ev = kind === 'ev', rows = ev ? evalRows() : moisRows();
  var cell = 'border:1px solid #CBD5E1;padding:5px 8px;text-align:center;font-weight:800;font-size:13px;';
  var table = '<table style="width:100%;border-collapse:collapse;color:'+INK+'"><tr>'
    + '<th style="background:'+NAVY+';color:#fff;border:1px solid '+NAVY+';padding:6px 8px;font-size:12.5px;text-align:left;width:40%">'+(ev ? 'Seuil : '+esc(S.ev.seuil)+' / '+esc(S.ev.sur) : 'Demi-journées : '+esc(S.mo.dj))+'</th>'
    + '<th style="background:'+NAVY+';color:#fff;border:1px solid '+NAVY+';padding:6px;font-size:12.5px">Garçons</th>'
    + '<th style="background:'+RED+';color:#fff;border:1px solid '+RED+';padding:6px;font-size:12.5px">Filles</th>'
    + '<th style="background:'+NAVY+';color:#fff;border:1px solid '+NAVY+';padding:6px;font-size:12.5px">Total</th></tr>'
    + rows.map(function(r){
        var bg = r.pc ? 'background:#EEF2FF;' : '';
        return '<tr style="'+bg+'"><td style="'+cell+'text-align:left;'+(r.pc?'color:'+NAVY+';':'')+'">'+r.l+'</td><td style="'+cell+bg+'">'+r.v[0]+'</td><td style="'+cell+bg+'color:'+RED+'">'+r.v[1]+'</td><td style="'+cell+bg+'">'+r.v[2]+'</td></tr>';
      }).join('') + '</table>';
  var sign = function(titre, nom){
    return '<div style="width:270px;text-align:center"><div style="font-weight:800;font-size:13.5px;color:'+NAVY+';text-decoration:underline;text-underline-offset:3px">'+titre+'</div>'
      + '<div style="height:44px"></div><div style="font-size:10.5px;color:'+SOFT+';border-top:1px dashed #94A3B8;padding-top:2px;margin:0 30px">Signature et cachet</div>'
      + '<div style="margin-top:4px;font-weight:800;font-size:13px;color:'+INK+';min-height:18px">'+(nom ? esc(nom) : '')+'</div></div>';
  };
  var titre = ev ? 'STATISTIQUES D’ÉVALUATION' : 'STATISTIQUES DE FIN DE MOIS';
  var sous = ev ? esc(S.ev.type) : esc(S.mo.mois);
  var page = document.createElement('div');
  page.style.cssText = "position:relative;width:794px;height:1123px;box-sizing:border-box;overflow:hidden;background:#fff;font-family:'Inter','Poppins',Arial,sans-serif;color:"+INK+";";
  page.innerHTML = '<div style="position:absolute;left:0;right:0;top:0;height:10px;background:linear-gradient(100deg,'+NAVY+',#2B5BE0)"></div>'
    + '<div style="position:absolute;left:40px;right:40px;top:24px;height:520px">'
    +   '<div style="display:flex;justify-content:space-between;align-items:center;font-size:11px;font-weight:700;color:'+SOFT+'"><span style="display:flex;align-items:center"><span style="display:inline-block;width:9px;height:9px;border-radius:50%;background:#F59E0B;margin-right:6px"></span><span style="font-weight:800;font-size:13px;color:'+NAVY+'">FicheProBot</span></span><span>Année scolaire '+anneeScolaire()+'</span></div>'
    +   '<div style="text-align:center;margin-top:8px"><div style="font-size:22px;font-weight:800;color:'+NAVY+'">'+titre+'</div>'
    +   '<div style="font-size:14px;font-weight:800;color:'+SOFT+';margin-top:2px;min-height:18px">'+(ev ? 'Type : ' : 'Mois de ')+sous+'</div>'
    +   '<div style="width:80px;height:3px;border-radius:2px;background:#F59E0B;margin:5px auto 0"></div></div>'
    +   '<div style="margin-top:12px;display:flex;flex-direction:column;gap:9px">' + infoLine('École', i.ecole)
    +     '<div style="display:flex;gap:20px">'+infoLine('Circonscription scolaire', i.circ, 1.6)+infoLine('Classe', i.classe, 1)+'</div></div>'
    +   '<div style="margin-top:12px">'+table+'</div>'
    +   '<div style="margin-top:12px;font-size:12.5px;font-weight:700;color:'+INK+';font-style:italic">Je certifie exacts les renseignements ci-dessus.</div>'
    +   '<div style="display:flex;justify-content:space-between;margin-top:8px">'+sign('Le Directeur', i.directeur)+sign('L’Enseignant(e)', i.enseignant)+'</div>'
    + '</div>'
    + '<div style="position:absolute;left:40px;right:40px;top:548px;display:flex;justify-content:space-between;font-size:9px;color:#94A3B8"><span>FicheProBot — l’éducation autrement</span><span></span></div>';
  return page;
}

function validate(kind){
  var i = S.info, m = [];
  if(!clean(i.ecole)) m.push('le nom de l’école');
  if(!clean(i.circ)) m.push('la circonscription scolaire');
  if(!clean(i.classe)) m.push('la classe');
  if(kind === 'ev'){
    var e = S.ev;
    if(!clean(e.type)) m.push('le type d’évaluation');
    if(!filled(e.seuil) || !filled(e.sur)) m.push('le seuil');
    if(m.length) return 'Renseigne d’abord : ' + m.join(', ') + '.';
    if(!filled(e.ins[0]) || !filled(e.ins[1]) || !filled(e.comp[0]) || !filled(e.comp[1]) || !filled(e.att[0]) || !filled(e.att[1])) return 'Renseigne tous les effectifs (garçons et filles), même s’ils sont à 0.';
    for(var k = 0; k < 2; k++){
      var s = k ? 'filles' : 'garçons';
      if(num(e.comp[k]) > num(e.ins[k])) return 'Chez les ' + s + ', le nombre d’élèves qui ont composé dépasse celui des inscrits.';
      if(num(e.att[k]) > num(e.comp[k])) return 'Chez les ' + s + ', le nombre d’élèves qui ont atteint le seuil dépasse celui des élèves qui ont composé.';
    }
  } else {
    var o = S.mo;
    if(!o.mois) m.push('le mois');
    if(!(num(o.dj) > 0)) m.push('le nombre de demi-journées');
    if(m.length) return 'Renseigne d’abord : ' + m.join(', ') + '.';
    if(!filled(o.ins[0]) || !filled(o.ins[1]) || !filled(o.abs[0]) || !filled(o.abs[1])) return 'Renseigne les inscrits et les absences (garçons et filles), même à 0.';
    for(var j = 0; j < 2; j++){
      if(num(o.abs[j]) > num(o.ins[j]) * num(o.dj)) return 'Chez les ' + (j ? 'filles' : 'garçons') + ', les absences dépassent la présence possible (inscrits × demi-journées).';
    }
  }
  return '';
}

function slug(t){ return String(t||'').normalize('NFD').replace(/[̀-ͯ]/g,'').replace(/[^A-Za-z0-9]+/g,'_').replace(/^_+|_+$/g,''); }
async function pdf(kind){
  errMsg = validate(kind);
  if(errMsg){ (kind === 'ev' ? renderStatsEval : renderStatsMois)(); window.scrollTo(0, document.body.scrollHeight); return; }
  if(typeof html2pdf === 'undefined'){ alert("Le module PDF n'est pas encore chargé. Vérifie ta connexion puis réessaie."); return; }
  try{
    dlProgressStart('Création de ton PDF', 'Mise en page de la fiche…');
    var doc = await html2pdf().set({ jsPDF:{ unit:'mm', format:'a4', orientation:'portrait', compress:true } }).from(document.createElement('div')).toPdf().get('pdf');
    var pageEl = buildPage(kind);
    var root = document.getElementById('pdf-root');
    if(!root){ root = document.createElement('div'); root.id = 'pdf-root'; document.body.appendChild(root); }
    root.innerHTML = ''; root.appendChild(pageEl);
    if(typeof waitForImages === 'function') await waitForImages(root);
    var canvas = await html2pdf().set({ html2canvas:{ scale:3.5, useCORS:true, letterRendering:true, backgroundColor:'#ffffff', scrollX:0, scrollY:0 } }).from(pageEl).toCanvas().get('canvas');
    var data = null, fmt = 'PNG';
    try{ data = canvas.toDataURL('image/png'); }catch(e){ data = null; }
    if(!data || data.length > 4500000){ data = canvas.toDataURL('image/jpeg', 0.97); fmt = 'JPEG'; }
    doc.addImage(data, fmt, 0, 0, 210, 297, undefined, 'FAST');
    root.innerHTML = '';
    var nom = kind === 'ev' ? 'Statistiques_evaluation_' : 'Statistiques_' + (slug(S.mo.mois) || 'mois') + '_';
    downloadPdfBlob(doc.output('blob'), nom + (slug(S.info.classe) || 'classe') + '.pdf');
  }catch(err){
    console.error(err);
    try{ dlProgressDone(); }catch(_){}
    alert('Impossible de créer le PDF. Réessaie.');
  }
}

window.SC = {
  info: function(k, v){ S.info[k] = String(v || ''); save(); },
  ev: function(k, v){ S.ev[k] = String(v || ''); save(); if(k === 'seuil' || k === 'sur') return; },
  mo: function(k, v){ S.mo[k] = String(v || ''); save(); refreshPrev('mo'); },
  n: function(kind, key, i, v){ S[kind][key][i] = String(v || ''); save(); refreshPrev(kind); },
  pdf: pdf,
  _pageEv: function(){ return buildPage('ev'); }, _pageMo: function(){ return buildPage('mo'); }, _state: S, _validate: validate
};
})();

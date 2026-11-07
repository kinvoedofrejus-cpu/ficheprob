/*
  CARTE « FICHE D'INTÉGRATION » (accueil) — classes CE1 à CM2.

  Matières : Lecture (seule matière de français), Mathématiques, ES, EST, Expression écrite, Dessin, EPS.

  Démarche de la fiche (même mise en page et même PDF que les autres fiches) :
   - Mise en situation : « Tu as appris beaucoup de choses en (matière) » → l'élève liste les notions apprises ;
     puis « Que ferons-nous maintenant, à la veille des évaluations ? » → l'élève répond : intégration (ou révision).
   - Proposition de nouvelles acquisitions : « Aujourd'hui, tu feras l'intégration de tes acquis. »
   - Activités de construction de nouveaux savoirs : l'enseignant dit OÙ IL EN EST DANS LE PROGRAMME (il coche les SA
     déjà étudiées, exactement comme dans l'onglet Épreuves) et l'appli génère UNE ÉPREUVE COMPLÈTE, insérée dans cette
     rubrique SANS en-tête (consignes = épreuve, résultats attendus = corrigé). EPS : pas de SA, trois niveaux.
   - Les rubriques pré-remplies (mise en situation, proposition, objectivation, évaluation, projection) et les champs
     d'en-tête pré-remplis ne sont pas affichés à l'enseignant ; ils restent dans la fiche et dans le PDF.
   - Retour et projection : Objectivation / Évaluation / Projection, comme d'habitude.

  Supports : Mathématiques = calculés dans le navigateur (EPH._maths) ; Lecture, ES, EST, Expression écrite, Dessin = rédigés
  par /api/generate-epreuve (compteur journalier à part : scope « fiche ») ; EPS = banque locale ci-dessous.

  Dépend de index.html : state, render, fiches, saveFiches, blankFiche, canCreateFiche, recordFicheCreated, backToList,
  ensureResumesLoaded, dlIdentity, canEditLockedFiche, escapeHtml ; et de epreuves.js (EPH.forIntegration, EPH.docToFiche, EPH._maths).
*/
(function(){
'use strict';

var CLASSES = ['CE1','CE2','CM1','CM2'];
var MATS = [
  { key:'integrationLecture', nom:'Lecture',               label:'Intégration — Lecture',           en:'lecture',                                  type:'lecture', color:'orange', duree:'45 min' },
  { key:'integrationMaths',   nom:'Mathématiques',         label:'Intégration — Mathématiques',     en:'mathématiques',                            type:'maths',   color:'blue',   duree:'1 h' },
  { key:'integrationES',      nom:'Éducation sociale (ES)',label:'Intégration — ES',                en:'éducation sociale',                        type:'es',      color:'purple', duree:'45 min' },
  { key:'integrationEST',     nom:'EST',                   label:'Intégration — EST',               en:'éducation scientifique et technologique',  type:'est',     color:'blue',   duree:'45 min' },
  { key:'integrationEE',      nom:'Expressions écrites',   label:'Intégration — Expression écrite', en:'expression écrite',                        type:'ee',      color:'green',  duree:'45 min' },
  { key:'integrationDessin',  nom:'Dessin',                label:'Intégration — Dessin',            en:'dessin',                                   type:'dessin',  color:'green',  duree:'30 min' },
  { key:'integrationEPS',     nom:'EPS',                   label:'Intégration — EPS',               en:'EPS',                                      type:'eps',     color:'orange', duree:'30 min' }
];
var LABEL_ACT = 'Activités de construction de nouveaux savoirs';
var LV_LAB = { 1:'Début de programme', 2:'En cours de programme', 3:'Fin de programme' };

/* Squelette commun : Introduction (2 rubriques) / Réalisation / Retour et projection. */
var SKELETON = [
  { phase:'Introduction',         items:['Mise en situation','Proposition de nouvelles acquisitions'] },
  { phase:'Réalisation',          items:[LABEL_ACT] },
  { phase:'Retour et projection', items:['Objectivation','Évaluation','Projection'] }
];
var SUBJ = {};
MATS.forEach(function(m){ SUBJ[m.key] = { label:m.label, ready:true, skeleton:SKELETON, integration:true }; });
window.INTEG_SUBJECTS = SUBJ;   // fusionné dans ALL_MATIERES par index.html

function byKey(k){ for(var i=0;i<MATS.length;i++) if(MATS[i].key===k) return MATS[i]; return null; }
function esc(s){ return (typeof escapeHtml === 'function') ? escapeHtml(String(s==null?'':s)) : String(s==null?'':s).replace(/[&<>"]/g,function(c){ return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]; }); }
function sleep(ms){ return new Promise(function(r){ setTimeout(r, ms); }); }
function newSeed(){ try{ var a = new Uint32Array(1); crypto.getRandomValues(a); return (a[0] & 0x7fffffff) || 1; }catch(e){ return Math.floor(Math.random()*2147483646)+1; } }
var MOIS = ['JANVIER','FÉVRIER','MARS','AVRIL','MAI','JUIN','JUILLET','AOÛT','SEPTEMBRE','OCTOBRE','NOVEMBRE','DÉCEMBRE'];
/* Niveau minimal imposé par le générateur de mathématiques d'épreuves : CE1 → 2, CE2 à CM2 → 3. */
function minLevel(classe, type){ return type==='maths' ? (classe==='CE1' ? 2 : 3) : 1; }

/* ------------------------------------------------------------------ */
/* Style                                                               */
/* ------------------------------------------------------------------ */
function ensureStyle(){
  if(document.getElementById('integ-style')) return;
  var st = document.createElement('style'); st.id = 'integ-style';
  st.textContent = ''
    + '.ig-box{border:1.5px solid var(--line,#E3E8EF);border-radius:12px;padding:10px 12px;margin:6px 0 12px;background:#F6F9FD}'
    + '.ig-tt{font-size:12.5px;font-weight:700;color:var(--ink,#1B2740);margin:0 0 6px}'
    + '.ig-chips{display:grid;grid-template-columns:repeat(3,1fr);gap:6px}'
    + '.ig-chip{border:1.5px solid var(--line,#E3E8EF);background:#fff;border-radius:10px;padding:7px 4px;font-weight:700;font-size:13px;color:var(--ink,#1B2740);cursor:pointer;line-height:1.2;touch-action:manipulation}'
    + '.ig-chip small{display:block;font-weight:500;font-size:10.5px;color:var(--ink-soft,#5B6577);margin-top:2px}'
    + '.ig-chip.on{background:var(--blue,#0A6FD8);border-color:var(--blue,#0A6FD8);color:#fff}'
    + '.ig-chip.on small{color:#E6F0FF}'
    + '.ig-chip.off,.ig-chip:disabled{opacity:.45;cursor:default}'
    + '.ig-note{font-size:11.5px;color:var(--ink-soft,#5B6577);margin:6px 0 0}'
    + '.ig-err{font-size:12px;color:#B3261E;background:#FDECEA;border-radius:8px;padding:6px 8px;margin:6px 0 0}'
    + '.ig-wait{display:flex;align-items:center;gap:8px;font-size:12.5px;color:var(--ink-soft,#5B6577);margin:8px 0 0}'
    + '.ig-spin{width:16px;height:16px;border:2.5px solid #CFE0F7;border-top-color:var(--blue,#0A6FD8);border-radius:50%;animation:igspin .8s linear infinite}'
    + '@keyframes igspin{to{transform:rotate(360deg)}}'
    + '.ig-box textarea{width:100%;min-height:54px;margin-top:8px;border:1.5px solid var(--line,#E3E8EF);border-radius:10px;padding:8px;font:inherit;font-size:13px;box-sizing:border-box;resize:vertical}'
    + '.ig-again{margin-top:8px;width:100%;border:1.5px solid var(--line,#E3E8EF);background:#fff;border-radius:10px;padding:8px;font-weight:700;font-size:12.5px;color:var(--blue,#0A6FD8);cursor:pointer}'
    + '.ig-again:disabled{opacity:.5}'
    + '.ig-tools{display:flex;gap:8px;margin:6px 0 8px}'
    + '.ig-tools button{flex:1;padding:8px;border:1.5px solid var(--line,#E3E8EF);border-radius:10px;background:#fff;font-weight:700;font-size:12.5px;color:var(--blue,#0A6FD8);cursor:pointer;touch-action:manipulation}'
    + '.ig-tools button.soft{color:var(--ink-soft,#5B6577)}'
    + '.ig-row{display:flex;align-items:center;gap:10px;border:1.5px solid var(--line,#E3E8EF);background:#fff;border-radius:10px;padding:8px 10px;margin:0 0 6px;cursor:pointer}'
    + '.ig-row.on{border-color:var(--blue,#0A6FD8);background:#EEF5FE}'
    + '.ig-ck{flex:0 0 20px;width:20px;height:20px;border:1.5px solid var(--line,#C9D3E0);border-radius:6px;background:#fff;display:flex;align-items:center;justify-content:center;font-size:13px;font-weight:800;color:#fff}'
    + '.ig-row.on .ig-ck{background:var(--blue,#0A6FD8);border-color:var(--blue,#0A6FD8)}'
    + '.ig-tx{flex:1;font-weight:700;font-size:13px;color:var(--ink,#1B2740);line-height:1.25}'
    + '.ig-tx small{display:block;font-weight:500;font-size:11px;color:var(--ink-soft,#5B6577);margin-top:2px}'
    + '.ig-upto{flex:0 0 auto;border:1.5px solid var(--line,#E3E8EF);background:#fff;border-radius:8px;padding:5px 8px;font-size:11.5px;font-weight:700;color:var(--blue,#0A6FD8);cursor:pointer}'
    + '.ig-go{margin-top:10px;width:100%;border:none;background:var(--blue,#0A6FD8);color:#fff;border-radius:10px;padding:11px;font-weight:800;font-size:13.5px;cursor:pointer;touch-action:manipulation}'
    + '.ig-go:disabled{opacity:.5;cursor:default}'
    + '.ig-sum{display:flex;align-items:center;justify-content:space-between;gap:8px;font-size:12.5px;font-weight:700;color:var(--ink,#1B2740);background:#fff;border:1.5px solid var(--line,#E3E8EF);border-radius:10px;padding:8px 10px}'
    + '.ig-sum small{display:block;font-weight:500;font-size:11px;color:var(--ink-soft,#5B6577)}'
    + '.ig-sum button{border:1.5px solid var(--line,#E3E8EF);background:#fff;border-radius:8px;padding:5px 9px;font-size:12px;font-weight:700;color:var(--blue,#0A6FD8);cursor:pointer}';
  document.head.appendChild(st);
}

/* ------------------------------------------------------------------ */
/* Écrans : classe → matière → fiche                                   */
/* ------------------------------------------------------------------ */
window.openIntegration = function(){
  if(typeof canCreateFiche === 'function' && !canCreateFiche()){ state = { view:'paywall' }; render(); return; }
  state = { view:'integration' };
  render();
  window.scrollTo(0,0);
};

function renderIntegration(){
  ensureStyle();
  var vp = document.getElementById('viewport'); if(!vp) return;
  var cls = state && state.classe;
  var icon = (typeof PICKER_ICONS !== 'undefined' && PICKER_ICONS.ce1cm2) ? PICKER_ICONS.ce1cm2 : '';
  var book = (typeof BOOK_ICON !== 'undefined') ? BOOK_ICON : '';
  if(!cls){
    var cards = CLASSES.map(function(c, i){
      var col = ['blue','green','orange','purple'][i];
      return '<div class="fichecard pc-nf picker-card picker-card--'+col+'" onclick="INTEG.classe(\''+c+'\')"><div class="picker-icon">'+icon+'</div><h3>'+c+'</h3></div>';
    }).join('');
    vp.innerHTML = '<button class="backbtn" onclick="backToList()">← Retour</button>'
      + '<div class="masthead" style="border-bottom:none; margin-bottom:16px;"><div><span class="eyebrow">Fiche d\u2019intégration</span><h1>Choisir la <em>classe</em></h1></div></div>'
      + '<div class="grid grid--2 grid--cols2">'+cards+'</div>';
    return;
  }
  var mats = MATS.map(function(m){
    return '<div class="fichecard pc-nf picker-card picker-card--'+m.color+'" onclick="INTEG.create(\''+m.key+'\')"><div class="picker-icon">'+book+'</div><h3>'+esc(m.nom)+'</h3></div>';
  }).join('');
  vp.innerHTML = '<button class="backbtn" onclick="INTEG.back()">← Retour</button>'
    + '<div class="masthead" style="border-bottom:none; margin-bottom:16px;"><div><span class="eyebrow">Fiche d\u2019intégration — '+esc(cls)+'</span><h1>Choisir la <em>matière</em></h1></div></div>'
    + '<div class="grid grid--2 grid--cols2">'+mats+'</div>';
}
window.renderIntegration = renderIntegration;

/* ------------------------------------------------------------------ */
/* Création de la fiche (rubriques pré-remplies)                       */
/* ------------------------------------------------------------------ */
function bullets(a){ return a.map(function(x){ return '\u2022 '+x; }).join('\n'); }
function prefill(f, m, cls){
  var en = m.en;
  var P = {
    'Mise en situation': {
      c: bullets([
        'Tu as appris beaucoup de choses en '+en+' depuis le début de l\u2019année.',
        'Cite les notions que tu as apprises en '+en+'.',
        'Nous sommes à la veille des évaluations : que ferons-nous maintenant ?'
      ]),
      r: bullets([
        'L\u2019élève cite les notions apprises en '+en+'.',
        'L\u2019élève répond : « l\u2019intégration » (ou « la révision »).'
      ])
    },
    'Proposition de nouvelles acquisitions': {
      c: bullets(['Aujourd\u2019hui, tu feras l\u2019intégration de tes acquis.']),
      r: 'A répondu aux consignes'
    },
    'Objectivation': {
      c: bullets(['Dis ce que tu as fait aujourd\u2019hui.','Dis comment tu as procédé pour réussir.','Dis les difficultés que tu as rencontrées.']),
      r: 'A répondu aux consignes'
    },
    'Évaluation': {
      c: bullets(['Présente ton travail à la classe.','Corrige tes erreurs avec le maître.']),
      r: 'A répondu aux consignes'
    },
    'Projection': {
      c: bullets(['Que feras-tu de ce que tu as appris ?']),
      r: 'A répondu aux consignes'
    }
  };
  f.phases.forEach(function(p){
    p.items.forEach(function(it){
      var v = P[it.label];
      if(v){ it.consignes = v.c; it.resultats = v.r; }
    });
  });
}

var creating = false;
async function create(key){
  if(creating) return;
  var m = byKey(key), cls = state && state.classe; if(!m || !cls) return;
  creating = true;
  /* Niveaux de compte : fiches par jour + maximum de fiches d'intégration du niveau (réglés par l'admin). */
  if(typeof fpbTierFicheGate === 'function' && !(await fpbTierFicheGate('manual', true))){ creating = false; return; }
  try{
    var f = blankFiche(key, cls);
    f.mode = 'manual';
    f.integration = { classe:cls, niveau:0, notions:'', sel:{}, open:true, busy:false, err:'', hid:[] };
    f.header.matiere = m.label;
    f.header.cours = cls;
    f.header.duree = m.duree;
    f.header.titre = 'Intégration des acquis en '+m.en;
    prefill(f, m, cls);
    /* champs d'en-tête déjà remplis : non affichés à l'enseignant (restent dans la fiche et le PDF) */
    f.integration.hid = Object.keys(f.header).filter(function(k){ return k!=='matiere' && String(f.header[k]||'').trim(); });
    fiches.push(f);
    saveFiches(fiches);
    if(typeof recordFicheCreated === 'function') await recordFicheCreated();
    state = { view:'form', ficheId:f.id, back:{ view:'integration', classe:cls } };
    render();
    window.scrollTo(0,0);
  } finally { creating = false; }
}

/* ------------------------------------------------------------------ */
/* Éléments masqués à l'enseignant (pré-remplis)                        */
/* ------------------------------------------------------------------ */
var HID_LABELS = ['Mise en situation','Proposition de nouvelles acquisitions','Objectivation','Évaluation','Projection'];
window.integHiddenLabels = function(f){ return (f && f.integration) ? HID_LABELS : []; };
window.integHiddenHeaderKeys = function(f){
  if(!f || !f.integration) return [];
  var h = f.integration.hid;
  if(h && h.length) return h;
  /* fiches créées avant cette version */
  var k = ['cours','duree','titre','competenceDisciplinaire','competencesTvCtd','strategies'];
  if(String((f.header||{}).enseignant||'').trim()) k.push('enseignant');
  return k;
};

/* ------------------------------------------------------------------ */
/* Bloc « Où en es-tu dans le programme ? » (comme l'onglet Épreuves)    */
/* ------------------------------------------------------------------ */
function nivAuto(k, n){ if(!n) return 2; var r = k/n; return r < 0.34 ? 1 : (r < 0.67 ? 2 : 3); }
function groupsOf(f, m){
  if(!window.EPH || !EPH.integGroups) return [];
  try{ return EPH.integGroups(f.header.cours || (f.integration && f.integration.classe) || 'CM2', m.type) || []; }catch(e){ return []; }
}
var loadingResumes = false;
function ensureLoaded(f){
  if(loadingResumes || typeof ensureResumesLoaded !== 'function') return;
  loadingResumes = true;
  Promise.race([ensureResumesLoaded(), sleep(8000)]).catch(function(){}).then(function(){ loadingResumes = false; rerender(f); });
}
window.integLevelHtml = function(f, it){
  if(!f || !f.integration || !it || it.label !== LABEL_ACT) return '';
  var I = f.integration, m = byKey(f.subjectKey); if(!m) return '';
  ensureStyle();
  if(!I.sel) I.sel = {};
  var locked = !!f.locked && !(typeof canEditLockedFiche === 'function' && canEditLockedFiche());
  var dis = locked || I.busy;
  var body = '';

  if(m.type === 'eps'){
    /* EPS : pas de résumés par SA → trois niveaux selon l'avancement */
    var chips = [1,2,3].map(function(n){
      return '<button type="button" class="ig-chip'+(I.niveau===n?' on':'')+'"'+(dis ? ' disabled' : ' onclick="INTEG.level(\''+f.id+'\','+n+')"')+'>Niveau '+n+'<small>'+LV_LAB[n]+'</small></button>';
    }).join('');
    body = '<div class="ig-tt">Où en es-tu dans le programme ?</div><div class="ig-chips">'+chips+'</div>'
      + '<p class="ig-note">Choisis selon ton avancement dans le programme ; plus le niveau est élevé, plus l\u2019activité est complète (enchaînements, équipes, arbitrage).</p>';
  } else {
    var gs = groupsOf(f, m);
    var loading = (typeof resumesCache !== 'undefined' && resumesCache === null);
    var nSel = gs.filter(function(g){ return I.sel[g.key]; }).length;
    body = '<div class="ig-tt">1. Où en es-tu dans la matière ?</div>';
    if(loading){
      body += '<div class="ig-wait"><div class="ig-spin"></div>Chargement des résumés…</div>';
      ensureLoaded(f);
    } else if(!gs.length){
      body += '<p class="ig-note">Aucun résumé de '+esc(m.en)+' en '+esc(f.header.cours)+' pour le moment. Écris ci-dessous les leçons à couvrir (une par ligne) pour générer quand même l\u2019épreuve.</p>';
    } else if(I.open === false && nSel){
      var noms = gs.filter(function(g){ return I.sel[g.key]; }).map(function(g){ return g.key; });
      body += '<div class="ig-sum"><span>✓ '+nSel+' SA cochée'+(nSel>1?'s':'')+' sur '+gs.length+'<small>'+esc(noms.length>3 ? noms.slice(0,3).join(' ; ')+' …' : noms.join(' ; '))+'</small></span>'
        + (dis ? '' : '<button type="button" onclick="INTEG.open(\''+f.id+'\',true)">Modifier</button>')+'</div>';
    } else {
      body += '<div class="ig-tools"><button type="button"'+(dis?' disabled':'')+' onclick="INTEG.all(\''+f.id+'\',true)">Tout cocher</button><button type="button" class="soft"'+(dis?' disabled':'')+' onclick="INTEG.all(\''+f.id+'\',false)">Tout décocher</button></div>'
        + '<p class="ig-note" style="margin:0 0 8px">'+nSel+' sur '+gs.length+' SA cochée'+(nSel>1?'s':'')+'. Astuce : « jusqu\u2019ici » coche tout ce qui précède.</p>'
        + gs.map(function(g,i){
            var on = !!I.sel[g.key];
            return '<div class="ig-row'+(on?' on':'')+'"'+(dis?'':' onclick="INTEG.toggle(\''+f.id+'\','+i+')"')+'><span class="ig-ck">'+(on?'✓':'')+'</span>'
              + '<span class="ig-tx">'+esc(g.key)+'<small>'+esc(g.sub)+'</small></span>'
              + (dis?'':'<button type="button" class="ig-upto" onclick="event.stopPropagation();INTEG.upto(\''+f.id+'\','+i+')">jusqu\u2019ici</button>')+'</div>';
          }).join('');
    }
    body += '<div class="ig-tt" style="margin-top:10px">Autres leçons à couvrir (facultatif)</div>'
      + '<textarea placeholder="Une leçon par ligne, ex. Les fractions décimales" '+(locked?'readonly ':'')+'oninput="INTEG.notions(\''+f.id+'\',this.value)">'+esc(I.notions||'')+'</textarea>'
      + (m.type==='maths' && minLevel(f.header.cours, m.type)>1 ? '<p class="ig-note">Plus tu as avancé dans le programme (SA cochées), plus l\u2019épreuve est exigeante.</p>' : '');
  }

  var canGo = (m.type==='eps') ? false : true;
  var go = '';
  if(canGo && !locked){
    go = '<button type="button" class="ig-go"'+(I.busy?' disabled':' onclick="INTEG.generate(\''+f.id+'\')"')+'>'+(I.done ? 'Générer une autre épreuve' : 'Générer l\u2019épreuve d\u2019intégration')+'</button>'
      + '<p class="ig-note" style="text-align:center">L\u2019épreuve complète est insérée ci-dessous, sans en-tête, avec son corrigé en « Résultats attendus ».</p>';
  }
  return '<div class="ig-box"><div class="ig-tt" style="font-size:13.5px">Épreuve d\u2019intégration</div>'+body
    + go
    + (I.busy ? '<div class="ig-wait"><div class="ig-spin"></div>Rédaction de l\u2019épreuve…</div>' : '')
    + (I.err ? '<div class="ig-err">'+esc(I.err)+'</div>' : '')
    + ((m.type==='eps' && I.niveau && !I.busy && !locked) ? '<button type="button" class="ig-again" onclick="INTEG.level(\''+f.id+'\','+I.niveau+')">Proposer une autre activité (niveau '+I.niveau+')</button>' : '')
    + '</div>';
};

function findF(id){ return (typeof findFiche === 'function') ? findFiche(id) : (fiches||[]).filter(function(x){ return x.id===id; })[0]; }
function actItem(f){
  for(var i=0;i<f.phases.length;i++) for(var j=0;j<f.phases[i].items.length;j++) if(f.phases[i].items[j].label===LABEL_ACT) return f.phases[i].items[j];
  return null;
}
function rerender(f){
  if(state && state.view==='form' && state.ficheId===f.id){ var y = window.pageYOffset || 0; render(); try{ window.scrollTo(0,y); }catch(e){} }
}

/* ------------------------------------------------------------------ */
/* Génération des supports et consignes                                */
/* ------------------------------------------------------------------ */
function ident(){ try{ if(typeof dlIdentity === 'function') return dlIdentity(); }catch(e){} return { phone:'', code:'', deviceId:'' }; }
var TEXTES = ['portrait','affiche','narration','lettre','compte','conte','article'];
function texteAuto(seed, resumes, notions){
  var t = (resumes.map(function(r){ return r.titre; }).join(' ')+' '+notions).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
  var order = [['admin',/administrative/],['portrait',/portrait/],['affiche',/affiche/],['compte',/compte rendu/],['conte',/conte/],['article',/article|journal/],['narration',/narration|recit/],['lettre',/lettre/]];
  for(var i=0;i<order.length;i++) if(order[i][1].test(t)) return order[i][0];
  return TEXTES[seed % TEXTES.length];
}
var LIMIT_MSG = 'Tu as atteint la limite journalière de propositions de supports. Reviens demain, ou rédige les activités à la main.';
async function fetchDoc(type, classe, lv, seed, resumes, notions){
  var body = { type:type, classe:classe, mois:MOIS[new Date().getMonth()], seed:seed, niveau:lv, notions:notions, scope:'fiche',
    texteType: type==='ee' ? texteAuto(seed, resumes, notions) : '', resumes:resumes };
  var id = ident(); body.phone = id.phone; body.code = id.code; body.deviceId = id.deviceId;
  var data = null;
  for(var essai=0; essai<3; essai++){
    var ctrl = (typeof AbortController !== 'undefined') ? new AbortController() : null;
    var to = setTimeout(function(){ if(ctrl) ctrl.abort(); }, 90000);
    try{
      body.seed = seed + essai*13;
      var res = await fetch('/api/generate-epreuve', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(body), signal: ctrl ? ctrl.signal : undefined });
      data = await res.json().catch(function(){ return null; });
    }catch(e){ data = null; }
    finally{ clearTimeout(to); }
    if(data && data.ok) break;
    if(data && (data.reason==='no-content' || data.reason==='quota' || data.reason==='invalid-params' || data.reason==='limit')) break;
    if(essai<2) await sleep(3000*(essai+1));
  }
  if(!data || !data.ok){
    var rs = data && data.reason;
    throw new Error(rs==='limit' ? LIMIT_MSG
      : rs==='no-content' ? 'Aucun résumé de cette matière n\u2019est disponible : écris les leçons à couvrir dans « Notions à intégrer ».'
      : rs==='quota' ? 'Le forfait quotidien de la rédaction automatique est épuisé. Il se renouvelle chaque jour.'
      : !data ? 'La connexion a été interrompue. Vérifie ton réseau puis réessaie.'
      : 'La rédaction automatique est très sollicitée en ce moment. Réessaie dans une minute.');
  }
  var e = data.epreuve || {};
  var doc = { type:type, support:e.support, tache:e.tache, items:e.items||[], consigne:e.consigne||[], corrige:(e.corrige&&e.corrige.length) ? e.corrige : [] };
  if(!doc.corrige.length) doc.corrige = [{ item:'Corrigé', lignes:['Réponses à valider par l\u2019enseignant selon les résumés de cours.'] }];
  return doc;
}

/* EPS : banque locale (aucun serveur). 3 niveaux × 3 propositions ; les distances suivent la classe. */
var EPS_D = { CE1:20, CE2:30, CM1:40, CM2:50 };
function epsBank(d){
  return {
    1: [
      { t:'Parcours d\u2019habiletés', sup:'Un terrain de '+d+' m, 6 plots, 4 cerceaux, 1 cible au mur, 1 balle par groupe.',
        tache:'Traverse le parcours sans t\u2019arrêter en réinvestissant ce que tu as appris : courir, sauter, lancer.',
        dep:['Cours en zigzag entre les plots.','Saute à pieds joints dans les cerceaux.','Lance la balle sur la cible, puis reviens en courant.','Les autres élèves observent et disent si les gestes sont corrects.'],
        res:['Enchaîne les trois gestes dans l\u2019ordre, sans s\u2019arrêter.','Saute à pieds joints et se réceptionne sans tomber.','Lance la balle avec la bonne main, vers la cible.'] },
      { t:'Relais en navette', sup:'Deux lignes distantes de '+Math.round(d/2)+' m, 4 plots, 1 témoin (bâtonnet) par équipe.',
        tache:'Par équipes de 4, fais passer le témoin le plus vite possible en respectant les règles du relais.',
        dep:['Cours jusqu\u2019à la ligne opposée, contourne le plot et reviens.','Donne le témoin dans la main du camarade suivant, sans le lancer.','Attends ton tour derrière la ligne de départ.','Applaudis l\u2019équipe qui a respecté toutes les règles.'],
        res:['Passe le témoin dans la zone prévue.','Respecte son tour et reste derrière la ligne.','Court en ligne droite et contourne bien le plot.'] },
      { t:'Jeu des déménageurs', sup:'Un terrain de '+d+' m, 2 caisses, 10 petits objets (bouchons, sachets de sable).',
        tache:'Transporte tous les objets d\u2019une caisse à l\u2019autre en courant, un seul objet à la fois.',
        dep:['Prends un objet dans la caisse de départ.','Cours jusqu\u2019à l\u2019autre caisse et dépose-le (ne le lance pas).','Reviens en courant et passe le relais au suivant.','L\u2019équipe gagnante est celle qui a vidé sa caisse en premier.'],
        res:['Dépose l\u2019objet sans le lancer.','Court sans bousculer ses camarades.','Respecte la règle : un seul objet à la fois.'] }
    ],
    2: [
      { t:'Circuit : course – saut – lancer', sup:'Un circuit de '+d+' m avec 3 ateliers : ligne de course, zone de saut en longueur (sable ou craie), cible de lancer ; 1 balle par atelier.',
        tache:'Passe les trois ateliers dans l\u2019ordre et fais de ton mieux à chacun, en appliquant les conseils appris.',
        dep:['Atelier 1 : cours le plus vite possible jusqu\u2019à la ligne d\u2019arrivée.','Atelier 2 : saute le plus loin possible, départ pieds joints ou avec élan, réception sur deux pieds.','Atelier 3 : lance la balle dans la cible, trois essais.','Après chaque atelier, un camarade note ton résultat sur l\u2019ardoise.'],
        res:['Court en ligne droite, sans ralentir avant l\u2019arrivée.','Se réceptionne sur les deux pieds, en équilibre.','Touche la cible au moins une fois sur trois.','Note correctement les résultats.'] },
      { t:'Relais par équipes avec obstacles', sup:'Un couloir de '+d+' m, 3 haies basses (ou briques), 4 plots, 1 témoin par équipe.',
        tache:'Réalise le relais avec obstacles en équipe et organise-toi pour gagner sans faute.',
        dep:['Cours, franchis les trois haies sans les faire tomber.','Contourne le plot de retour et reviens en courant.','Passe le témoin dans la zone de transmission.','Un élève arbitre vérifie les fautes (haie renversée, témoin lancé).'],
        res:['Franchit les obstacles sans les renverser.','Transmet le témoin dans la zone de transmission.','Respecte l\u2019arbitre et accepte ses décisions.'] },
      { t:'Jeu collectif simplifié : passes et tir', sup:'Un terrain de '+Math.round(d/2)+' m × '+Math.round(d/3)+' m, 2 buts (plots ou cartons), 1 ballon, chasubles de deux couleurs.',
        tache:'Joue par équipes de 4 : fais circuler le ballon par des passes avant de tirer au but.',
        dep:['Chaque équipe réalise au moins trois passes avant de tirer.','Le défenseur n\u2019a pas le droit de toucher le porteur du ballon.','Après chaque but, les équipes reprennent leur place.','Un élève compte les buts et les passes.'],
        res:['Fait circuler le ballon avec au moins trois passes.','Respecte les règles : pas de contact, pas de bousculade.','Compte et annonce correctement le score.'] }
    ],
    3: [
      { t:'Mini-compétition athlétique par équipes', sup:'Un terrain de '+d+' m ; matériel : plots, chronomètre ou montre, mètre ruban, balles ; 3 ateliers (vitesse, saut en longueur, lancer) avec des juges.',
        tache:'Prends part à la compétition par équipes et réinvestis la technique de chaque épreuve ; chaque élève joue aussi un rôle (athlète, juge ou chronométreur).',
        dep:['Vitesse : cours '+d+' m, le chronométreur note ton temps.','Saut en longueur : trois essais, le juge mesure et note le meilleur.','Lancer : trois essais, le juge mesure la distance du meilleur lancer.','Additionne les résultats de l\u2019équipe et affiche le classement.'],
        res:['Applique la technique de chaque épreuve.','Remplit correctement son rôle (juge ou chronométreur).','Lit et note correctement les mesures.','Accepte le classement dans le respect des autres.'] },
      { t:'Triathlon scolaire', sup:'Un parcours de '+d+' m : course d\u2019un plot à l\u2019autre, 5 sauts de haies basses, lancer sur cible ; chronomètre, ardoises.',
        tache:'Enchaîne course, saut et lancer sans pause ; chaque équipe organise son parcours et son contrôle.',
        dep:['Cours jusqu\u2019aux haies puis franchis-les sans toucher.','Enchaîne directement avec le lancer sur la cible.','Le chronométreur note le temps total, le juge note les fautes.','L\u2019équipe compare ses résultats avec ceux des autres équipes.'],
        res:['Enchaîne les trois épreuves sans pause inutile.','Contrôle son effort et finit le parcours.','Compare correctement les résultats et dit pourquoi une équipe a gagné.'] },
      { t:'Tournoi de jeux collectifs', sup:'Un terrain de '+d+' m × '+Math.round(d/2)+' m, 4 plots, 2 ballons, chasubles, sifflet ; 4 équipes.',
        tache:'Joue un petit tournoi en appliquant les règles et tiens ton rôle : joueur, arbitre ou marqueur.',
        dep:['Chaque match dure 4 minutes, trois matchs par équipe.','L\u2019arbitre siffle les fautes et le marqueur compte les points.','Entre les matchs, chaque équipe explique ce qu\u2019elle va changer.','À la fin, proclame le classement et félicite tous les joueurs.'],
        res:['Respecte les règles du jeu et l\u2019arbitre.','Tient correctement son rôle (joueur, arbitre ou marqueur).','Coopère avec ses coéquipiers.','Félicite les gagnants avec fair-play.'] }
    ]
  };
}
function epsFiche(cls, lv, seed){
  var list = epsBank(EPS_D[cls] || 30)[lv] || epsBank(30)[2];
  var v = list[seed % list.length];
  return {
    consignes: 'Support : '+v.t+'\nTerrain et matériel : '+v.sup+'\n\nTâche : '+v.tache+'\n\nDéroulement\n'+bullets(v.dep),
    resultats: 'Critères de réussite\n'+bullets(v.res),
    images: []
  };
}

async function generate(f, lv){
  var I = f.integration, m = byKey(f.subjectKey);
  if(!I || !m || I.busy) return;
  var it = actItem(f); if(!it) return;
  var cls = f.header.cours || I.classe || 'CM2';
  var selKeys = [];
  if(m.type !== 'eps'){
    var gs = groupsOf(f, m);
    selKeys = gs.filter(function(g){ return I.sel && I.sel[g.key]; }).map(function(g){ return g.key; });
    /* le niveau découle de l'avancement : part des SA cochées, comme dans l'onglet Épreuves */
    lv = nivAuto(selKeys.length, gs.length);
    lv = Math.max(lv, minLevel(cls, m.type));
  }
  I.niveau = lv; I.busy = true; I.err = '';
  rerender(f);
  try{
    var seed = newSeed(), res;
    var notions = String(I.notions || '').trim();
    if(m.type==='eps'){
      await sleep(250);
      res = epsFiche(cls, lv, seed);
    } else {
      if(!window.EPH || !EPH.forIntegration || !EPH.docToFiche) throw new Error('Le module des épreuves n\u2019est pas chargé. Recharge la page puis réessaie.');
      if(typeof ensureResumesLoaded === 'function'){ try{ await Promise.race([ensureResumesLoaded(), sleep(6000)]); }catch(e){} }
      var info = EPH.forIntegration(cls, m.type, lv, selKeys);
      if(!selKeys.length && !notions) throw new Error('Coche au moins une SA ou écris une leçon à couvrir.');
      var doc;
      if(m.type==='maths'){
        await sleep(250);
        doc = EPH._maths((info.text || '')+' '+notions, seed, cls, lv);
      } else {
        if(!info.resumes.length && !notions) throw new Error('Aucun résumé de '+m.en+' en '+cls+' pour les SA cochées : coche d\u2019autres SA ou écris les leçons à couvrir.');
        doc = await fetchDoc(m.type, cls, lv, seed, info.resumes, notions);
      }
      res = await EPH.docToFiche(doc);
    }
    it.consignes = res.consignes;
    it.resultats = res.resultats;
    it.images = res.images || [];
    it._integ = true;
    I.done = true; I.open = false;
    f.updatedAt = Date.now();
    saveFiches(fiches);
  }catch(e){
    I.err = (e && e.name==='AbortError') ? 'Le délai est dépassé. Réessaie.' : ((e && e.message) || 'Impossible de générer l\u2019épreuve pour le moment.');
  }finally{
    I.busy = false;
    rerender(f);
  }
}

var saveTimer = null;
window.INTEG = {
  classe: function(c){ state = { view:'integration', classe:c }; render(); window.scrollTo(0,0); },
  back: function(){ state = { view:'integration' }; render(); window.scrollTo(0,0); },
  create: create,
  level: function(id, lv){ var f = findF(id); if(f && f.integration) generate(f, lv); },
  generate: function(id){ var f = findF(id); if(f && f.integration) generate(f, 0); },
  open: function(id, v){ var f = findF(id); if(!f || !f.integration) return; f.integration.open = !!v; rerender(f); },
  toggle: function(id, i){ var f = findF(id), m = f && byKey(f.subjectKey); if(!m) return; var g = groupsOf(f, m)[i]; if(!g) return; var I = f.integration; I.sel = I.sel || {}; I.sel[g.key] = !I.sel[g.key]; saveFiches(fiches); rerender(f); },
  all: function(id, v){ var f = findF(id), m = f && byKey(f.subjectKey); if(!m) return; var I = f.integration; I.sel = {}; if(v) groupsOf(f, m).forEach(function(g){ I.sel[g.key] = true; }); saveFiches(fiches); rerender(f); },
  upto: function(id, i){ var f = findF(id), m = f && byKey(f.subjectKey); if(!m) return; var I = f.integration; I.sel = {}; groupsOf(f, m).forEach(function(g, k){ if(k<=i) I.sel[g.key] = true; }); saveFiches(fiches); rerender(f); },
  notions: function(id, v){
    var f = findF(id); if(!f || !f.integration) return;
    f.integration.notions = v;
    clearTimeout(saveTimer); saveTimer = setTimeout(function(){ try{ saveFiches(fiches); }catch(e){} }, 700);
  },
  _epsFiche: epsFiche, _byKey: byKey
};
})();

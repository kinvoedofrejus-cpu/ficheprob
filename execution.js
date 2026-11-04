/*
  CARTE « POINT D'EXÉCUTION DU PROGRAMME » (accueil) — classes CE1 à CM2.

  L'enseignant saisit son nom et prénom(s), son école, sa circonscription scolaire et sa classe, puis coche, matière par
  matière, les SA / unités / dossiers DÉJÀ FAITS. L'application les compare au projet de planification de la classe
  (planif-data*.js, mêmes données que « Planification mensuelle ») et sort un tableau par matière :
      Matière | Prévu (SA, unités ou dossiers) | Exécuté | % d'exécution
  téléchargeable en PDF (A4) : en-tête (circonscription, école, classe, enseignant) et, en bas, le nom de l'enseignant
  avec un espace pour signer.

  - Français : une unité = un groupe (le projet compte 12 unités, + « Diphtongues » au CE1).
  - Mathématiques : un dossier = un groupe. Autres matières : une SA = un groupe (ES : Morale, Civisme, Histoire,
    Géographie, Langues maternelles/Culture ; EPS ; EST ; Éducation artistique).
  - Les groupes sont obtenus avec les fonctions de la planification mensuelle de index.html (mpGroups, MP_SUBJ, MP_FILES).

  Dépend de index.html : state, render, escapeHtml, mpGroups, mpGroupLabel, MP_SUBJ, MP_FILES, downloadPdfBlob,
  dlProgressStart, dlProgressDone, html2pdf.
*/
(function(){
'use strict';

var CLASSES = ['CE1','CE2','CM1','CM2'];
var LS_KEY = 'fpb_exec_programme_v1';
var MOIS = ['janvier','février','mars','avril','mai','juin','juillet','août','septembre','octobre','novembre','décembre'];

/* Matières du tableau, dans l'ordre. k = clé de MP_SUBJ (ou 'fr'), unit = nature du groupe compté. */
var MATS = [
  { k:'fr',         nom:'Français',                  unit:'unité',   units:'unités'  },
  { k:'math',       nom:'Mathématiques',             unit:'dossier', units:'dossiers' },
  { k:'est',        nom:'EST',                       unit:'SA',      units:'SA' },
  { k:'morale',     nom:'Morale',                    unit:'SA',      units:'SA' },
  { k:'civisme',    nom:'Civisme',                   unit:'SA',      units:'SA' },
  { k:'histoire',   nom:'Histoire',                  unit:'SA',      units:'SA' },
  { k:'geographie', nom:'Géographie',                unit:'SA',      units:'SA' },
  { k:'lm_cult',    nom:'Langues maternelles / Culture', unit:'SA', units:'SA' },
  { k:'eps',        nom:'EPS',                       unit:'SA',      units:'SA' },
  { k:'ea',         nom:'Éducation artistique',      unit:'SA',      units:'SA' }
];

var S = { id:{ nom:'', ecole:'', circ:'' }, classe:'', sel:{}, open:{}, loaded:false, fail:{} };

function esc(x){ return (typeof escapeHtml === 'function') ? escapeHtml(String(x==null?'':x)) : String(x==null?'':x).replace(/[&<>"]/g,function(c){ return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]; }); }

/* ------------------------------------------------------------------ */
/* Sauvegarde locale (identité, classe, cases cochées)                  */
/* ------------------------------------------------------------------ */
function load(){
  if(S.loaded) return; S.loaded = true;
  try{
    var o = JSON.parse(localStorage.getItem(LS_KEY) || '{}') || {};
    if(o.id) S.id = { nom:o.id.nom||'', ecole:o.id.ecole||'', circ:o.id.circ||'' };
    if(o.classe && CLASSES.indexOf(o.classe) >= 0) S.classe = o.classe;
    if(o.sel && typeof o.sel === 'object') S.sel = o.sel;
  }catch(e){}
  if(!S.id.nom){   // pré-remplissage avec le nom du compte, s'il est connu
    try{ if(typeof knownTeacherName === 'function'){ var n = knownTeacherName(); if(n) S.id.nom = n; } }catch(e){}
  }
}
function save(){ try{ localStorage.setItem(LS_KEY, JSON.stringify({ id:S.id, classe:S.classe, sel:S.sel })); }catch(e){} }

/* ------------------------------------------------------------------ */
/* Données de planification                                             */
/* ------------------------------------------------------------------ */
function planData(c){ return (window.PLANIF_DATA && window.PLANIF_DATA[c]) || null; }
function ensureData(c){
  if(!c || planData(c) || S.fail[c] || document.getElementById('planif-data-'+c)) return;
  if(typeof MP_FILES === 'undefined' || !MP_FILES[c]){ S.fail[c] = true; return; }
  var sc = document.createElement('script');
  sc.id = 'planif-data-'+c; sc.src = MP_FILES[c];
  sc.onload = function(){ if(state && state.view==='execution') renderExecution(true); };
  sc.onerror = function(){ S.fail[c] = true; sc.remove(); if(state && state.view==='execution') renderExecution(true); };
  document.head.appendChild(sc);
}
/* Groupes (unités / dossiers / SA) prévus pour une matière : [{ key, label }] dans l'ordre du projet. */
function groupsOf(c, m){
  var d = planData(c); if(!d) return [];
  try{
    if(m.k === 'fr'){
      var seen = {}, out = [];
      d.forEach(function(o){
        var u = o.u; if(u == null || seen[u]) return; seen[u] = 1;
        out.push({ key:'U'+u, label: u===0 ? 'Diphtongues' : 'Unité '+u, n:u });
      });
      return out.sort(function(a,b){ return a.n - b.n; });
    }
    /* CE2 : le projet liste les THÈMES de l'éducation sociale (ex. 15 thèmes de morale), pas les SA. Comme au CE1, au CM1 et au CM2,
       chaque matière d'ES forme ici une SA (Morale = 1 SA) ; Langues maternelles et Culture sont deux SA à part. */
    if(c === 'CE2' && ['morale','civisme','histoire','geographie','lm_cult'].indexOf(m.k) >= 0 && typeof mpEntries === 'function'){
      var isLC = function(e){ return /^(Culture|Langues maternelles)\s*:/i.test(String(e.t||'')); };
      if(m.k === 'lm_cult'){
        var lc = mpEntries('geographie', c).filter(isLC), out2 = [];
        if(lc.some(function(e){ return /^Langues maternelles/i.test(e.t); })) out2.push({ key:'LM', label:'Langues maternelles' });
        if(lc.some(function(e){ return /^Culture/i.test(e.t); })) out2.push({ key:'CU', label:'Culture' });
        return out2;
      }
      var ent = mpEntries(m.k, c).filter(function(e){ return m.k !== 'geographie' || !isLC(e); });
      return ent.length ? [{ key:m.k, label:m.nom }] : [];
    }
    var sj = (typeof MP_SUBJ !== 'undefined') ? MP_SUBJ.filter(function(x){ return x.k === m.k; })[0] : null;
    if(!sj) return [];
    if(sj.only && sj.only.indexOf(c) < 0) return [];
    return mpGroups(m.k, c).map(function(g){
      var lab = (typeof mpGroupLabel === 'function') ? mpGroupLabel(m.k, g) : g;
      return { key:g, label:lab };
    });
  }catch(e){ return []; }
}
function selOf(c, k){ S.sel[c] = S.sel[c] || {}; return (S.sel[c][k] = S.sel[c][k] || {}); }

/* ------------------------------------------------------------------ */
/* Calcul du tableau                                                    */
/* ------------------------------------------------------------------ */
function compute(c){
  var rows = [], tp = 0, te = 0;
  MATS.forEach(function(m){
    var gs = groupsOf(c, m); if(!gs.length) return;
    var s = selOf(c, m.k), done = gs.filter(function(g){ return s[g.key]; }).length;
    var pct = Math.round(done / gs.length * 100);
    rows.push({ m:m, gs:gs, prevu:gs.length, exec:done, pct:pct });
    tp += gs.length; te += done;
  });
  return { rows:rows, prevu:tp, exec:te, pct: tp ? Math.round(te/tp*100) : 0 };
}
function nb(n, m){ return n + ' ' + (n>1 ? m.units : m.unit); }
function tone(p){ return p >= 75 ? '#1B8A4B' : (p >= 40 ? '#D98A00' : '#C0392B'); }

/* ------------------------------------------------------------------ */
/* Style de l'écran                                                     */
/* ------------------------------------------------------------------ */
function ensureStyle(){
  if(document.getElementById('exec-style')) return;
  var st = document.createElement('style'); st.id = 'exec-style';
  st.textContent = ''
    + '.ex-box{background:#fff;border:1px solid var(--line,#E3E8EF);border-radius:14px;padding:12px;margin:0 0 12px}'
    + '.ex-tt{font-family:Poppins,sans-serif;font-weight:800;font-size:13px;color:var(--blue,#0A6FD8);margin:0 0 8px}'
    + '.ex-box input[type=text]{width:100%;box-sizing:border-box;border:1.5px solid var(--line,#E3E8EF);border-radius:10px;padding:10px;font:inherit;font-size:14px;margin:0 0 8px;background:#fff}'
    + '.ex-lbl{display:block;font-size:12px;font-weight:700;color:var(--ink-soft,#5B6577);margin:0 0 4px}'
    + '.ex-chips{display:grid;grid-template-columns:repeat(4,1fr);gap:6px}'
    + '.ex-chip{border:1.5px solid var(--line,#E3E8EF);background:#fff;border-radius:10px;padding:9px 2px;font-weight:800;font-size:14px;color:var(--ink,#1B2740);cursor:pointer;touch-action:manipulation}'
    + '.ex-chip.on{background:var(--blue,#0A6FD8);border-color:var(--blue,#0A6FD8);color:#fff}'
    + '.ex-mat{border:1px solid var(--line,#E3E8EF);border-radius:12px;background:#fff;margin:0 0 8px;overflow:hidden}'
    + '.ex-mh{display:flex;align-items:center;gap:10px;padding:11px 12px;cursor:pointer}'
    + '.ex-mn{flex:1;font-weight:800;font-size:14px;color:var(--ink,#1B2740);line-height:1.25}'
    + '.ex-mn small{display:block;font-weight:600;font-size:11.5px;color:var(--ink-soft,#5B6577);margin-top:2px}'
    + '.ex-pc{font-weight:800;font-size:13px;min-width:44px;text-align:right}'
    + '.ex-arr{font-size:12px;color:var(--ink-soft,#5B6577)}'
    + '.ex-mb{padding:0 12px 12px;border-top:1px solid var(--line,#E3E8EF)}'
    + '.ex-tools{display:flex;gap:8px;margin:10px 0 8px}'
    + '.ex-tools button{flex:1;padding:8px;border:1.5px solid var(--line,#E3E8EF);border-radius:10px;background:#fff;font-weight:700;font-size:12.5px;color:var(--blue,#0A6FD8);cursor:pointer;touch-action:manipulation}'
    + '.ex-tools button.soft{color:var(--ink-soft,#5B6577)}'
    + '.ex-row{display:flex;align-items:center;gap:10px;border:1.5px solid var(--line,#E3E8EF);background:#fff;border-radius:10px;padding:8px 10px;margin:0 0 6px;cursor:pointer}'
    + '.ex-row.on{border-color:var(--blue,#0A6FD8);background:#EEF5FE}'
    + '.ex-ck{flex:0 0 20px;width:20px;height:20px;border:1.5px solid #C9D3E0;border-radius:6px;background:#fff;display:flex;align-items:center;justify-content:center;font-size:13px;font-weight:800;color:#fff}'
    + '.ex-row.on .ex-ck{background:var(--blue,#0A6FD8);border-color:var(--blue,#0A6FD8)}'
    + '.ex-tx{flex:1;font-weight:700;font-size:13px;color:var(--ink,#1B2740);line-height:1.25}'
    + '.ex-upto{flex:0 0 auto;border:1.5px solid var(--line,#E3E8EF);background:#fff;border-radius:8px;padding:5px 8px;font-size:11.5px;font-weight:700;color:var(--blue,#0A6FD8);cursor:pointer}'
    + '.ex-tbl{width:100%;border-collapse:collapse;font-size:12.5px}'
    + '.ex-tbl th{background:#1E3A8A;color:#fff;font-weight:700;padding:7px 6px;text-align:center;border:1px solid #1E3A8A}'
    + '.ex-tbl th:first-child,.ex-tbl td:first-child{text-align:left}'
    + '.ex-tbl td{padding:7px 6px;border:1px solid #CBD5E1;text-align:center;color:var(--ink,#1B2740)}'
    + '.ex-tbl tr.tot td{font-weight:800;background:#EEF2FF}'
    + '.ex-go{width:100%;margin:6px 0 0;border:none;background:var(--blue,#0A6FD8);color:#fff;border-radius:12px;padding:13px;font-weight:800;font-size:14px;cursor:pointer;touch-action:manipulation}'
    + '.ex-note{font-size:12px;color:var(--ink-soft,#5B6577);margin:6px 0 0;line-height:1.4}'
    + '.ex-err{font-size:12.5px;color:#B3261E;background:#FDECEA;border-radius:8px;padding:8px 10px;margin:8px 0 0}'
    + '.ex-wait{display:flex;align-items:center;gap:8px;font-size:12.5px;color:var(--ink-soft,#5B6577);padding:8px 0}'
    + '.ex-spin{width:16px;height:16px;border:2.5px solid #CFE0F7;border-top-color:var(--blue,#0A6FD8);border-radius:50%;animation:exspin .8s linear infinite}'
    + '@keyframes exspin{to{transform:rotate(360deg)}}';
  document.head.appendChild(st);
}

/* ------------------------------------------------------------------ */
/* Écran                                                                */
/* ------------------------------------------------------------------ */
window.openExecution = function(){
  load();
  state = { view:'execution' };
  render();
  window.scrollTo(0,0);
};

var errMsg = '';
function renderExecution(keepScroll){
  ensureStyle(); load();
  var vp = document.getElementById('viewport'); if(!vp) return;
  var y = keepScroll ? (window.pageYOffset || 0) : 0;
  var c = S.classe;
  if(c) ensureData(c);

  var chips = CLASSES.map(function(k){
    return '<button type="button" class="ex-chip'+(c===k?' on':'')+'" onclick="EXEC.classe(\''+k+'\')">'+k+'</button>';
  }).join('');

  var body = '';
  if(!c){
    body = '<p class="ex-note" style="text-align:center;margin:14px 0">Choisis ta classe pour afficher le programme à contrôler.</p>';
  } else if(!planData(c)){
    body = S.fail[c]
      ? '<div class="ex-err">Le projet de planification du '+esc(c)+' est indisponible hors connexion. Réessaie avec Internet.</div>'
      : '<div class="ex-wait"><div class="ex-spin"></div>Chargement du projet de planification…</div>';
  } else {
    var R = compute(c);
    var mats = R.rows.map(function(r){
      var k = r.m.k, s = selOf(c, k), open = !!S.open[k];
      var head = '<div class="ex-mh" onclick="EXEC.open(\''+k+'\')"><div class="ex-mn">'+esc(r.m.nom)+'<small>'+r.exec+' sur '+nb(r.prevu, r.m)+' faits</small></div>'
        + '<div class="ex-pc" style="color:'+tone(r.pct)+'">'+r.pct+' %</div><div class="ex-arr">'+(open?'▲':'▼')+'</div></div>';
      var inner = '';
      if(open){
        inner = '<div class="ex-mb"><div class="ex-tools"><button type="button" onclick="EXEC.all(\''+k+'\',true)">Tout cocher</button><button type="button" class="soft" onclick="EXEC.all(\''+k+'\',false)">Tout décocher</button></div>'
          + '<p class="ex-note" style="margin:0 0 8px">Coche ce que tu as déjà fait. Astuce : « jusqu\u2019ici » coche tout ce qui précède.</p>'
          + r.gs.map(function(g, i){
              var on = !!s[g.key];
              return '<div class="ex-row'+(on?' on':'')+'" onclick="EXEC.toggle(\''+k+'\','+i+')"><span class="ex-ck">'+(on?'✓':'')+'</span><span class="ex-tx">'+esc(g.label)+'</span>'
                + '<button type="button" class="ex-upto" onclick="event.stopPropagation();EXEC.upto(\''+k+'\','+i+')">jusqu\u2019ici</button></div>';
            }).join('') + '</div>';
      }
      return '<div class="ex-mat">'+head+inner+'</div>';
    }).join('');

    var tbl = '<table class="ex-tbl"><tr><th>Matière</th><th>Prévu</th><th>Exécuté</th><th>% d\u2019exécution</th></tr>'
      + R.rows.map(function(r){
          return '<tr><td>'+esc(r.m.nom)+'</td><td>'+esc(nb(r.prevu, r.m))+'</td><td>'+r.exec+'</td><td style="font-weight:800;color:'+tone(r.pct)+'">'+r.pct+' %</td></tr>';
        }).join('')
      + '<tr class="tot"><td>Ensemble du programme</td><td>'+R.prevu+'</td><td>'+R.exec+'</td><td style="color:'+tone(R.pct)+'">'+R.pct+' %</td></tr></table>';

    body = '<div class="ex-tt" style="margin-top:4px">2. Où en es-tu, matière par matière ?</div>' + mats
      + '<div class="ex-tt" style="margin-top:14px">3. Ton tableau</div><div class="ex-box" style="padding:8px">'+tbl+'</div>'
      + (errMsg ? '<div class="ex-err">'+esc(errMsg)+'</div>' : '')
      + '<button type="button" class="ex-go" onclick="EXEC.pdf()">Télécharger le tableau en PDF</button>'
      + '<p class="ex-note" style="text-align:center">Ton nom est inscrit en bas du document, avec un espace pour signer.</p>';
  }

  vp.innerHTML = '<button class="backbtn" onclick="state={view:\'list\'}; render();">← Retour</button>'
    + '<div class="masthead" style="border-bottom:none;margin-bottom:10px"><div><span class="eyebrow">Suivi du programme</span><h1>Point d\u2019exécution <em>du programme</em></h1></div></div>'
    + '<p class="ex-note" style="margin:0 0 12px">Coche les SA, unités et dossiers déjà faits : l\u2019application les compare au projet de planification et calcule ton taux d\u2019exécution par matière.</p>'
    + '<div class="ex-box"><div class="ex-tt">1. Tes informations</div>'
    + '<label class="ex-lbl">Nom et prénom(s)</label><input type="text" autocomplete="name" value="'+esc(S.id.nom)+'" oninput="EXEC.f(\'nom\',this.value)" placeholder="Ex. ADJOVI Koffi Marc">'
    + '<label class="ex-lbl">École</label><input type="text" value="'+esc(S.id.ecole)+'" oninput="EXEC.f(\'ecole\',this.value)" placeholder="Ex. EPP Zogbodomey">'
    + '<label class="ex-lbl">Circonscription scolaire</label><input type="text" value="'+esc(S.id.circ)+'" oninput="EXEC.f(\'circ\',this.value)" placeholder="Ex. Zogbodomey">'
    + '<label class="ex-lbl">Classe</label><div class="ex-chips">'+chips+'</div></div>'
    + body + '<div style="height:16px"></div>';
  if(keepScroll){ try{ window.scrollTo(0,y); }catch(e){} }
}
window.renderExecution = renderExecution;

/* ------------------------------------------------------------------ */
/* PDF                                                                  */
/* ------------------------------------------------------------------ */
function dateFr(){ var d = new Date(); return d.getDate()+' '+MOIS[d.getMonth()]+' '+d.getFullYear(); }
function buildPdf(c){
  var R = compute(c), id = S.id;
  var NAVY = '#16327A', BLUE = '#2563EB', INK = '#0F172A', SOFT = '#475569', LINE = '#E2E8F0';
  var page = document.createElement('div');
  page.style.cssText = "position:relative;width:794px;height:1123px;box-sizing:border-box;overflow:hidden;background:#fff;font-family:'Inter','Poppins',Arial,sans-serif;color:"+INK+";";
  var rows = R.rows.map(function(r, i){
    var bg = i % 2 ? '#F5F8FD' : '#FFFFFF', col = tone(r.pct);
    return '<tr style="background:'+bg+'">'
      + '<td style="padding:10px 12px;font-weight:700;font-size:13px;border-bottom:1px solid '+LINE+';color:'+INK+'">'+esc(r.m.nom)+'</td>'
      + '<td style="padding:10px 6px;text-align:center;font-size:13px;border-bottom:1px solid '+LINE+';color:'+INK+'">'+esc(nb(r.prevu, r.m))+'</td>'
      + '<td style="padding:10px 6px;text-align:center;font-size:13px;font-weight:700;border-bottom:1px solid '+LINE+';color:'+INK+'">'+r.exec+'</td>'
      + '<td style="padding:10px 12px;border-bottom:1px solid '+LINE+'"><div style="display:flex;align-items:center">'
      +   '<div style="flex:1;height:8px;background:#E2E8F0;border-radius:4px;overflow:hidden"><div style="height:8px;width:'+r.pct+'%;background:'+col+';border-radius:4px"></div></div>'
      +   '<div style="width:52px;text-align:right;font-weight:800;font-size:13px;color:'+col+'">'+r.pct+' %</div></div></td></tr>';
  }).join('');
  var th = 'background:'+NAVY+';color:#fff;font-weight:700;font-size:12px;padding:11px 8px;text-align:center;letter-spacing:.2px';
  var card = function(lab, val){
    return '<div style="flex:1;background:#F5F8FD;border:1px solid '+LINE+';border-radius:10px;padding:9px 13px;min-width:0">'
      + '<div style="font-size:10px;font-weight:700;letter-spacing:.8px;text-transform:uppercase;color:'+BLUE+'">'+lab+'</div>'
      + '<div style="font-size:13.5px;font-weight:700;color:'+INK+';margin-top:3px;overflow-wrap:anywhere">'+(esc(val) || '—')+'</div></div>';
  };
  var gcol = tone(R.pct);
  var fit = document.createElement('div');
  fit.style.cssText = 'width:100%;';
  fit.innerHTML = ''
    + '<div style="display:flex;justify-content:space-between;align-items:center">'
    +   '<div style="display:flex;align-items:center"><span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:#F59E0B;margin-right:8px"></span><span style="font-weight:800;font-size:15px;color:'+NAVY+'">FicheProBot</span></div>'
    +   '<div style="font-size:12px;font-weight:600;color:'+SOFT+'">'+esc(dateFr())+'</div></div>'
    + '<div style="background:linear-gradient(100deg,'+NAVY+',#2B5BE0);border-radius:14px;padding:22px 24px;color:#fff;text-align:center;margin-top:14px">'
    +   '<div style="font-size:11px;font-weight:700;letter-spacing:2px;opacity:.85">SUIVI DU PROGRAMME</div>'
    +   '<div style="font-size:25px;font-weight:800;letter-spacing:.5px;margin-top:5px">POINT D’EXÉCUTION DU PROGRAMME</div>'
    +   '<div style="display:inline-block;background:rgba(255,255,255,.18);border-radius:20px;padding:4px 16px;font-size:13px;font-weight:700;margin-top:10px">Classe : '+esc(c)+'</div></div>'
    + '<div style="display:flex;margin-top:14px"><div style="flex:1.3;margin-right:10px;display:flex">'+card('Enseignant(e)', id.nom)+'</div><div style="flex:1;display:flex">'+card('École', id.ecole)+'</div></div>'
    + '<div style="display:flex;margin-top:10px">'+card('Circonscription scolaire', id.circ)+'</div>'
    + '<div style="display:flex;align-items:center;border:1.5px solid '+gcol+';border-radius:12px;padding:12px 18px;margin-top:14px;background:#fff">'
    +   '<div style="font-size:34px;font-weight:800;color:'+gcol+';line-height:1;min-width:104px">'+R.pct+' %</div>'
    +   '<div style="flex:1;margin-left:14px"><div style="font-size:13px;font-weight:700;color:'+INK+'">Taux d’exécution de l’ensemble du programme</div>'
    +   '<div style="font-size:11.5px;color:'+SOFT+';margin:2px 0 7px">'+R.exec+' faits sur '+R.prevu+' prévus</div>'
    +   '<div style="height:9px;background:#E2E8F0;border-radius:5px;overflow:hidden"><div style="height:9px;width:'+R.pct+'%;background:'+gcol+';border-radius:5px"></div></div></div></div>'
    + '<div style="border:1px solid '+LINE+';border-radius:12px;overflow:hidden;margin-top:14px"><table style="width:100%;border-collapse:collapse">'
    +   '<colgroup><col style="width:30%"><col style="width:19%"><col style="width:13%"><col style="width:38%"></colgroup>'
    +   '<tr><th style="'+th+';text-align:left;padding-left:12px">Matière</th><th style="'+th+'">Prévu<div style="font-weight:500;font-size:9.5px;opacity:.85">(SA, unités, dossiers)</div></th><th style="'+th+'">Exécuté</th><th style="'+th+'">% d’exécution</th></tr>'
    +   rows + '</table></div>'
    + '<div style="font-size:10.5px;color:'+SOFT+';margin-top:8px;line-height:1.4">Prévu : d’après le projet de planification du '+esc(c)+'. Exécuté : SA, unités et dossiers déclarés faits par l’enseignant(e).</div>'
    + '<div style="margin-top:26px;display:flex;justify-content:space-between;align-items:flex-start">'
    +   '<div style="font-size:12.5px;color:'+INK+';padding-top:4px">Fait à ..............................., le '+esc(dateFr())+'</div>'
    +   '<div style="width:260px;text-align:center"><div style="font-size:12.5px;color:'+INK+'">L’enseignant(e)</div>'
    +   '<div style="height:58px"></div><div style="border-top:1.5px solid '+INK+';padding-top:6px;font-weight:800;font-size:14px;color:'+INK+'">'+esc(id.nom)+'</div>'
    +   '<div style="font-size:10.5px;color:'+SOFT+';margin-top:2px">(nom et signature)</div></div></div>';
  var inner = document.createElement('div');
  inner.style.cssText = 'position:absolute;left:44px;right:44px;top:34px;height:1000px;overflow:hidden;';
  inner.appendChild(fit);
  page.appendChild(inner);
  var foot = document.createElement('div');
  foot.style.cssText = 'position:absolute;left:44px;right:44px;bottom:26px;border-top:1px solid '+LINE+';padding-top:8px;display:flex;justify-content:space-between;font-size:10px;color:#64748B';
  foot.innerHTML = '<span>FicheProBot — l’éducation autrement</span><span>Point d’exécution du programme · '+esc(c)+'</span>';
  page.appendChild(foot);
  page._fit = fit; page._avail = 1000;
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
  var miss = [];
  if(!String(S.id.nom).trim()) miss.push('ton nom et prénom(s)');
  if(!String(S.id.ecole).trim()) miss.push('ton école');
  if(!String(S.id.circ).trim()) miss.push('ta circonscription scolaire');
  if(!c) miss.push('ta classe');
  if(miss.length){ errMsg = 'Renseigne d\u2019abord : '+miss.join(', ')+'.'; renderExecution(true); return; }
  if(typeof html2pdf === 'undefined'){ alert("Le module PDF n'est pas encore chargé. Vérifie ta connexion puis réessaie."); return; }
  var filename = ('Point_execution_programme_'+c+'_'+S.id.nom).replace(/[^\wÀ-ÿ.-]+/g,'_').replace(/_+/g,'_').replace(/_$/,'') + '.pdf';
  try{
    dlProgressStart('Création de ton PDF', 'Mise en page du tableau…');
    var page = buildPdf(c);
    var doc = await newA4Pdf();
    var root = document.getElementById('pdf-root') || document.body.appendChild(Object.assign(document.createElement('div'), { id:'pdf-root' }));
    root.innerHTML = ''; root.appendChild(page);
    fitInto(page._fit, page._avail);
    await a4Page(page, doc, true);
    downloadPdfBlob(doc.output('blob'), filename);
  }catch(err){
    console.error(err);
    try{ dlProgressDone(); }catch(_){}
    alert('Impossible de créer le PDF. Réessaie.');
  }
}

/* ------------------------------------------------------------------ */
/* Actions                                                              */
/* ------------------------------------------------------------------ */
function matOf(k){ for(var i=0;i<MATS.length;i++) if(MATS[i].k===k) return MATS[i]; return null; }
window.EXEC = {
  f: function(key, v){ S.id[key] = v; save(); },
  classe: function(c){ S.classe = c; errMsg = ''; save(); renderExecution(true); },
  open: function(k){ S.open[k] = !S.open[k]; renderExecution(true); },
  toggle: function(k, i){ var m = matOf(k), gs = groupsOf(S.classe, m), g = gs[i]; if(!g) return; var s = selOf(S.classe, k); s[g.key] = !s[g.key]; save(); renderExecution(true); },
  all: function(k, v){ var m = matOf(k), s = selOf(S.classe, k); Object.keys(s).forEach(function(x){ delete s[x]; }); if(v) groupsOf(S.classe, m).forEach(function(g){ s[g.key] = true; }); save(); renderExecution(true); },
  upto: function(k, i){ var m = matOf(k), s = selOf(S.classe, k); Object.keys(s).forEach(function(x){ delete s[x]; }); groupsOf(S.classe, m).forEach(function(g, j){ if(j<=i) s[g.key] = true; }); save(); renderExecution(true); },
  pdf: pdf,
  _compute: compute, _groups: groupsOf
};
})();

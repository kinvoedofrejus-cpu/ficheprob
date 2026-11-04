/*
  ONGLET « ÉPREUVES » — épreuves d'activité d'intégration générées automatiquement.

  L'enseignant choisit la classe, la matière et les SA déjà étudiées (tirées des résumés du site), puis
  l'année scolaire, la circonscription et l'école (affichées dans l'en-tête). L'appli sort l'épreuve et son
  corrigé type (sans barème), en PDF. 3 épreuves maximum par jour.

  - Mathématiques : TOUT est calculé ici (valeurs, figures SVG, corrigé) → le corrigé est toujours exact.
  - Autres matières : le texte est rédigé par le serveur (/api/generate-epreuve) à partir des résumés choisis ;
    les figures de circuits (EST) sont dessinées ici.
  - Mise en page : feuilles A4 identiques à l'aperçu et au PDF ; épreuves courtes (expression écrite, dessin)
    imprimées en deux exemplaires par feuille (« découper ici »).

  Dépend de index.html : state, render, escapeHtml, resumesCache, loadResumes, compareResumes,
  waitForImages, downloadPdfBlob, dlProgress*, html2pdf, PDFLib.
*/
(function(){
'use strict';

/* ------------------------------------------------------------------ */
/* Configuration                                                       */
/* ------------------------------------------------------------------ */
var CLASSES = ['CI','CP','CE1','CE2','CM1','CM2'];
var CLASSES_OK = { CI:true, CP:true, CE1:true, CE2:true, CM1:true, CM2:true };   // toutes les classes sont ouvertes
var TYPES = [
  { key:'maths',   label:'Mathématiques',                titre:'MATHÉMATIQUES',                  duree:'1 h',    mat:/^MATH/,                                         color:'blue'   },
  { key:'ee',      label:'Français · Expression écrite', titre:'FRANÇAIS — EXPRESSION ÉCRITE',   duree:'30 min', mat:/^EXPRESSION/,                                   color:'green',  dbl:true },
  { key:'lecture', label:'Français · Lecture',           titre:'FRANÇAIS — LECTURE',             duree:'30 min', mat:/^(LECTURE|GRAMMAIRE|ORTHOGRAPHE|CONJUGAISON|VOCABULAIRE)/, color:'orange' },
  { key:'es',      label:'Éducation sociale (ES)',       titre:'ÉDUCATION SOCIALE (ES)',         duree:'45 min', mat:/^ES\b/,                                         color:'purple' },
  { key:'est',     label:'EST',                          titre:'ÉDUCATION SCIENTIFIQUE ET TECHNOLOGIQUE (EST)', duree:'45 min', mat:/^EST\b/,                 color:'blue'   },
  { key:'dessin',  label:'Dessin',                       titre:'DESSIN',                         duree:'30 min', mat:/^DESSIN/,                                       color:'green',  dbl:true }
];
var TEXTES = [
  { key:'portrait',  label:'Le portrait',            mots:/portrait/ },
  { key:'affiche',   label:'L\u2019affiche',         mots:/affiche/ },
  { key:'narration', label:'La narration',           mots:/narration|r[ée]cit/ },
  { key:'lettre',    label:'La lettre personnelle',  mots:/lettre personnelle|lettre/ },
  { key:'compte',    label:'Le compte rendu',        mots:/compte rendu/ },
  { key:'conte',     label:'Le conte',               mots:/conte/ },
  { key:'article',   label:'L\u2019article de journal', mots:/article|journal/ },
  { key:'admin',     label:'La lettre administrative', mots:/administrative/ }
];
var MOIS = ['JANVIER','FÉVRIER','MARS','AVRIL','MAI','JUIN','JUILLET','AOÛT','SEPTEMBRE','OCTOBRE','NOVEMBRE','DÉCEMBRE'];
/* Matières des résumés selon la classe : en CI et CP les résumés de français s'appellent « FRANÇAIS : … » ;
   le dessin s'appelle aussi « GRAPHISME » en CI. */
function matOf(tp){
  var petit = (S.classe==='CI' || S.classe==='CP');
  if(tp.key==='ee') return petit ? /^(EXPRESSION|FRANCAIS)/ : tp.mat;
  if(tp.key==='lecture') return petit ? /^(LECTURE|GRAMMAIRE|ORTHOGRAPHE|CONJUGAISON|VOCABULAIRE|FRANCAIS)/ : tp.mat;
  if(tp.key==='dessin') return /^(DESSIN|GRAPHISME)/;
  return tp.mat;
}
/* Durée réduite pour les plus petits */
function dureeOf(tp){
  if(S.classe!=='CI' && S.classe!=='CP') return tp.duree;
  return { '1 h':'45 min', '45 min':'30 min', '30 min':'20 min' }[tp.duree] || tp.duree;
}
var LS_KEY = 'fpb_epreuve_entete';
var PAGE_W = 794, PAGE_H = 1122, PAD_X = 40, PAD_TOP = 30, PAD_BOT = 30, FOOT_H = 22;

var S = {
  step: 'type', classe: 'CM2', type: null, sel: {}, notions: '',
  ecole: '', circ: '', annee: '', mois: '', texte: '',
  saOpen: true, txtOpen: true, seed: 0, doc: null, pages: null, pagesCo: null, err: '', loaded: false
};

/* Graine aléatoire sur 31 bits (et non plus l'heure) : deux enseignants, ou deux générations, ne retombent pas sur la même épreuve */
var LIMIT_MSG = 'Tu as atteint la limite de 3 épreuves pour aujourd\u2019hui. Reviens demain pour en générer de nouvelles.';
function ident(){ try{ if(typeof dlIdentity==='function') return dlIdentity(); }catch(e){} return { phone:'', code:'', deviceId:'' }; }
function newSeed(){
  try{ var a = new Uint32Array(1); crypto.getRandomValues(a); return (a[0] % 2000000000) + 7; }
  catch(e){ return Math.floor(Math.random()*2000000000) + 7; }
}
function T(key){ for(var i=0;i<TYPES.length;i++) if(TYPES[i].key===key) return TYPES[i]; return null; }
function esc(s){ return (typeof escapeHtml === 'function') ? escapeHtml(String(s==null?'':s)) : String(s==null?'':s).replace(/[&<>"]/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c];}); }
function norm(s){ return String(s||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase(); }
function normUp(s){ return norm(s).toUpperCase(); }

function defAnnee(){ var d=new Date(), y=d.getFullYear(); return d.getMonth()>=8 ? y+'-'+(y+1) : (y-1)+'-'+y; }
function defMois(){ var d=new Date(); return MOIS[d.getMonth()]+' '+d.getFullYear(); }
function loadEntete(){
  if(S.loaded) return; S.loaded = true;
  var o = {}; try{ o = JSON.parse(localStorage.getItem(LS_KEY)||'{}') || {}; }catch(e){}
  S.ecole = o.ecole || ''; S.circ = o.circ || ''; S.annee = o.annee || defAnnee(); S.mois = '';
}
function saveEntete(){
  try{ localStorage.setItem(LS_KEY, JSON.stringify({ ecole:S.ecole, circ:S.circ, annee:S.annee })); }catch(e){}
}

/* ------------------------------------------------------------------ */
/* Aléatoire et nombres                                                */
/* ------------------------------------------------------------------ */
function mkR(seed){
  var a = (seed*7919+13)|0;
  function f(){ a|=0; a=a+0x6D2B79F5|0; var t=Math.imul(a^a>>>15,1|a); t=t+Math.imul(t^t>>>7,61|t)^t; return ((t^t>>>14)>>>0)/4294967296; }
  return {
    n: f,
    int: function(lo,hi){ return lo+Math.floor(f()*(hi-lo+1)); },
    pick: function(x){ return x[Math.floor(f()*x.length)]; },
    shuffle: function(x){ x=x.slice(); for(var i=x.length-1;i>0;i--){ var j=Math.floor(f()*(i+1)); var t=x[i]; x[i]=x[j]; x[j]=t; } return x; }
  };
}
function rnd(n){ return Math.round(n*1e6)/1e6; }
function fr(n){
  n = rnd(n);
  var neg = n<0; var p = String(Math.abs(n)).split('.');
  p[0] = p[0].replace(/\B(?=(\d{3})+(?!\d))/g,'\u00a0');
  return (neg?'-':'') + p.join(',');
}
function gcd(a,b){ return b?gcd(b,a%b):a; }
function frac(a,b){ var g=gcd(a,b); return (a/g)+'/'+(b/g); }

/* ------------------------------------------------------------------ */
/* Figures SVG                                                         */
/* ------------------------------------------------------------------ */
var INK = '#0b1f3f', FILL = '#eaf4ff';
function sv(w,h,inner,maxw){
  /* dimensions explicites en pixels : l'export PDF ne coupe plus les figures */
  var W = Math.min(maxw||560, w), H = Math.round(h*W/w);
  return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 '+w+' '+h+'" width="'+W+'" height="'+H+'" style="display:block;margin:0 auto" font-family="Arial,Helvetica,sans-serif" font-size="15">'+inner+'</svg>';
}
function tx(x,y,t,anchor){ return '<text x="'+x+'" y="'+y+'" text-anchor="'+(anchor||'middle')+'" fill="'+INK+'">'+esc(t)+'</text>'; }

/* shapes : tableau de { k:'carre'|'rect'|'tri'|'cercle', ... } posées sur 3 colonnes */
function shapesSvg(shapes){
  var out = '', xs = [80,300,540];
  shapes.forEach(function(s,i){
    var cx = xs[i], yb = 138;
    if(s.k==='carre'){
      out += '<rect x="'+(cx-50)+'" y="'+(yb-100)+'" width="100" height="100" fill="'+FILL+'" stroke="'+INK+'" stroke-width="2"/>';
      out += tx(cx,yb+20,s.c+' '+(s.u||'m')) + tx(cx+58,yb-46,s.c+' '+(s.u||'m'),'start');
    } else if(s.k==='rect'){
      out += '<rect x="'+(cx-80)+'" y="'+(yb-80)+'" width="160" height="80" fill="'+FILL+'" stroke="'+INK+'" stroke-width="2"/>';
      out += tx(cx,yb+20,s.L+' '+(s.u||'m')) + tx(cx+88,yb-36,s.l+' '+(s.u||'m'),'start');
    } else if(s.k==='tri'){
      var x0 = cx-50;
      out += '<polygon points="'+x0+','+yb+' '+(x0+100)+','+yb+' '+x0+','+(yb-110)+'" fill="'+FILL+'" stroke="'+INK+'" stroke-width="2"/>';
      out += '<polyline points="'+x0+','+(yb-12)+' '+(x0+12)+','+(yb-12)+' '+(x0+12)+','+yb+'" fill="none" stroke="'+INK+'" stroke-width="1.5"/>';
      out += tx(cx,yb+20,s.b+' '+(s.u||'m')) + tx(x0-8,yb-50,s.h+' '+(s.u||'m'),'end');
    } else if(s.k==='cercle'){
      out += '<circle cx="'+cx+'" cy="'+(yb-55)+'" r="55" fill="'+FILL+'" stroke="'+INK+'" stroke-width="2"/>';
      out += '<line x1="'+cx+'" y1="'+(yb-55)+'" x2="'+(cx+55)+'" y2="'+(yb-55)+'" stroke="'+INK+'" stroke-width="2"/><circle cx="'+cx+'" cy="'+(yb-55)+'" r="3" fill="'+INK+'"/>';
      out += tx(cx+28,yb-62,s.r+' m');
    }
  });
  return sv(640,166,out,540);
}

function lampe(x,y){ return '<circle cx="'+x+'" cy="'+y+'" r="14" fill="#fff" stroke="'+INK+'" stroke-width="2"/><line x1="'+(x-10)+'" y1="'+(y-10)+'" x2="'+(x+10)+'" y2="'+(y+10)+'" stroke="'+INK+'" stroke-width="2"/><line x1="'+(x-10)+'" y1="'+(y+10)+'" x2="'+(x+10)+'" y2="'+(y-10)+'" stroke="'+INK+'" stroke-width="2"/>'; }
function pileV(x,y){ /* pile sur fil vertical : trait long (+) puis court épais (−), centrée en y */ return '<line x1="'+(x-14)+'" y1="'+(y-6)+'" x2="'+(x+14)+'" y2="'+(y-6)+'" stroke="'+INK+'" stroke-width="2"/><line x1="'+(x-8)+'" y1="'+(y+6)+'" x2="'+(x+8)+'" y2="'+(y+6)+'" stroke="'+INK+'" stroke-width="5"/>'; }
function wire(x1,y1,x2,y2){ return '<line x1="'+x1+'" y1="'+y1+'" x2="'+x2+'" y2="'+y2+'" stroke="'+INK+'" stroke-width="2"/>'; }
function interH(x1,x2,y){ return wire(x1,y,x2,y)+'<circle cx="'+x1+'" cy="'+y+'" r="3.5" fill="'+INK+'"/><circle cx="'+x2+'" cy="'+y+'" r="3.5" fill="'+INK+'"/>'; }

function circuitInner(kind){
  var o = '';
  if(kind==='serie'){
    o += wire(30,30,116,30)+lampe(130,30)+wire(144,30,216,30)+lampe(230,30)+wire(244,30,330,30)+wire(330,30,330,120);
    o += wire(330,120,210,120)+interH(150,210,120)+wire(150,120,30,120);
    o += wire(30,30,30,64)+pileV(30,75)+wire(30,86,30,120);
  } else if(kind==='derivation'){
    o += wire(30,30,230,30)+wire(30,140,60,140)+interH(60,110,140)+wire(110,140,230,140);
    o += wire(130,30,130,71)+lampe(130,85)+wire(130,99,130,140);
    o += wire(230,30,230,71)+lampe(230,85)+wire(230,99,230,140);
    o += wire(30,30,30,79)+pileV(30,90)+wire(30,101,30,140);
  } else { /* circuit simple : pile, lampe, interrupteur fermé */
    o += wire(30,30,146,30)+lampe(160,30)+wire(174,30,300,30)+wire(300,30,300,120);
    o += wire(300,120,210,120)+interH(150,210,120)+wire(150,120,30,120);
    o += wire(30,30,30,64)+pileV(30,75)+wire(30,86,30,120);
  }
  return o;
}
function circuitSvg(kind){
  if(kind==='montages'){
    return '<div style="display:flex;gap:10px;justify-content:center;align-items:flex-start">'
      + '<div style="flex:1;text-align:center">'+sv(360,160,circuitInner('serie'),300)+'<div style="font-weight:bold;margin-top:2px">Montage A</div></div>'
      + '<div style="flex:1;text-align:center">'+sv(360,160,circuitInner('derivation'),300)+'<div style="font-weight:bold;margin-top:2px">Montage B</div></div></div>';
  }
  var k = (kind==='serie'||kind==='derivation') ? kind : 'circuit';
  return sv(360,160,circuitInner(k),300);
}

/* ------------------------------------------------------------------ */
/* Mathématiques : générateurs (valeurs, figures et corrigé exacts)    */
/* ------------------------------------------------------------------ */
function gridTable(cells, cols){
  var rows = '';
  for(var i=0;i<cells.length;i+=cols){
    rows += '<tr>' + cells.slice(i,i+cols).map(function(c){ return '<td style="border:1px solid #333;padding:3px 8px;text-align:center">'+esc(c)+'</td>'; }).join('') + '</tr>';
  }
  return '<table style="border-collapse:collapse;margin:6px auto;font-size:13px">'+rows+'</table>';
}

/* Item « données » */
function gStats(R){
  var N = R.pick([20,24,25,30,40]);
  var sets = [['Football','Lecture','Danse','Chant'],['Dessin','Football','Contes','Théâtre'],['Course','Saut en longueur','Lancer de balle','Jeu de ludo']];
  var names = R.pick(sets), c, ok = false, tries = 0;
  while(!ok && tries++ < 200){
    c = [2,2,2,2];
    for(var r = N-8; r>0; r--) c[R.int(0,3)]++;
    var mx = Math.max.apply(null,c);
    var mn = Math.min.apply(null,c);
    ok = c.filter(function(v){ return v===mx; }).length === 1 && c.filter(function(v){ return v===mn; }).length === 1;
  }
  var cells = [];
  names.forEach(function(nm,i){ for(var k=0;k<c[i];k++) cells.push(nm); });
  cells = R.shuffle(cells);
  var cols = (N%4===0) ? 4 : 5;
  var imax = c.indexOf(Math.max.apply(null,c)), imin = c.indexOf(Math.min.apply(null,c));
  function fq(n){ var p = n*100/N; var pc = (Math.abs(p-Math.round(p*10)/10) < 1e-9) ? ' (soit '+fr(Math.round(p*10)/10)+' %)' : ''; return n+'/'+N+(gcd(n,N)>1 ? ' = '+frac(n,N) : '')+pc; }
  return {
    ctx: 'Les '+N+' élèves de la classe choisissent chacun leur activité préférée : '+names[0].toLowerCase()+', '+names[1].toLowerCase()+', '+names[2].toLowerCase()+' ou '+names[3].toLowerCase()+'.',
    tags: 'effectif',
    intro: 'Voici les réponses recueillies auprès des '+N+' élèves :',
    tableHtml: gridTable(cells, cols),
    questions: [
      'Dénombre les élèves ayant choisi chaque activité et complète un tableau comportant les activités, les effectifs et les fréquences.',
      R.cls==='CM1' ? 'Quelle est l\u2019activité la plus choisie ? la moins choisie ? Calcule l\u2019écart entre leurs effectifs.' : 'Calcule l\u2019effectif moyen des quatre catégories d\u2019activités.',
      (R.lv>=2 && R.cls!=='CM1') ? 'Détermine la fréquence de l\u2019activité la plus choisie, puis l\u2019écart entre l\u2019effectif de la plus choisie et celui de la moins choisie.' : 'Détermine la fréquence de l\u2019activité la plus choisie.'
    ],
    corrige: [
      names.map(function(nm,i){ return nm+' : effectif '+c[i]+', fréquence '+fq(c[i]); }).join(' ; ')+'.',
      R.cls==='CM1' ? 'Plus choisie : '+names[imax].toLowerCase()+' ('+c[imax]+') ; moins choisie : '+names[imin].toLowerCase()+' ('+c[imin]+') ; écart = '+c[imax]+' \u2212 '+c[imin]+' = '+(c[imax]-c[imin])+'.' : 'Effectif moyen = '+N+' ÷ 4 = '+fr(N/4)+'.',
      'Activité la plus choisie : '+names[imax].toLowerCase()+' ; fréquence = '+fq(c[imax])+'.'+((R.lv>=2 && R.cls!=='CM1') ? ' Écart = '+c[imax]+' \u2212 '+c[imin]+' = '+(c[imax]-c[imin])+'.' : '')
    ]
  };
}
gStats.kw = [/statisti/g,/effectif/g,/frequen/g,/tableau/g,/diagramme/g,/denombr/g,/moyenne/g];

function gProp(R){
  var obj = R.pick([['Un cahier','cahiers'],['Un stylo','stylos'],['Un sachet de biscuits','sachets de biscuits'],['Une bouteille de jus','bouteilles de jus']]);
  var P = R.pick([100,150,200,250,300,500]);
  var ns = [1,3,5,8], n2 = R.pick([12,15,20]), k = R.pick([4,6,7,9]);
  var rowN = ['Nombre de '+obj[1]].concat(ns.map(String));
  var rowP = ['Prix (F CFA)', fr(P), '…', '…', '…'];
  var table = '<table style="border-collapse:collapse;margin:6px auto;font-size:13px">'
    + '<tr>'+rowN.map(function(c,i){ return '<td style="border:1px solid #333;padding:3px 10px;text-align:center'+(i?'':';font-weight:bold;text-align:left')+'">'+esc(c)+'</td>'; }).join('')+'</tr>'
    + '<tr>'+rowP.map(function(c,i){ return '<td style="border:1px solid #333;padding:3px 10px;text-align:center'+(i?'':';font-weight:bold;text-align:left')+'">'+esc(c)+'</td>'; }).join('')+'</tr></table>';
  return {
    ctx: 'Les organisateurs achètent des fournitures et des boissons pour les participants.',
    tags: 'proportionnalite',
    intro: obj[0]+' coûte '+fr(P)+' F CFA et le prix est proportionnel au nombre d\u2019articles achetés.',
    tableHtml: table,
    questions: [
      'Complète le tableau de proportionnalité.',
      (R.cls==='CM2' && R.lv>=2) ? 'Calcule le prix de '+n2+' '+obj[1]+', puis le prix à payer après une réduction de 10 %.' : 'Calcule le prix de '+n2+' '+obj[1]+'.',
      'Un élève paie '+fr(P*k)+' F CFA. Combien de '+obj[1]+' a-t-il achetés ?'
    ],
    corrige: [
      '3 → '+fr(P*3)+' F ; 5 → '+fr(P*5)+' F ; 8 → '+fr(P*8)+' F.',
      n2+' × '+fr(P)+' = '+fr(P*n2)+' F CFA.'+((R.cls==='CM2' && R.lv>=2) ? ' Réduction : '+fr(rnd(P*n2/10))+' F ; à payer : '+fr(rnd(P*n2*0.9))+' F CFA.' : ''),
      fr(P*k)+' ÷ '+fr(P)+' = '+k+' '+obj[1]+'.'
    ]
  };
}
gProp.kw = [/proportionnal/g,/pourcentage/g,/regle de trois/g,/prix/g,/monnaie/g,/cout/g,/achat/g];

/* Item « géométrie plane » */
function gAires(R){
  var c = R.pick([10,12,15,20,25,30]), L = R.pick([40,50,60,80]), l = R.pick([20,25,30]);
  var b = R.pick([10,12,16,20,24,30]), h = R.pick([10,15,20,25,30]);
  var aC = c*c, aR = L*l, aT = b*h/2, pg = R.pick([50,100,200]);
  return {
    ctx: 'L\u2019école aménage ensuite un espace composé de trois parties géométriques.',
    tags: 'aire',
    intro: 'L\u2019espace aménagé comprend un carré de '+c+' m de côté, un rectangle de '+L+' m de longueur et de '+l+' m de largeur, puis un triangle rectangle de base '+b+' m et de hauteur '+h+' m.',
    figureHtml: shapesSvg([{k:'carre',c:c},{k:'rect',L:L,l:l},{k:'tri',b:b,h:h}]),
    questions: ['Calcule l\u2019aire du carré et celle du rectangle.','Calcule l\u2019aire du triangle rectangle.','Détermine l\u2019aire totale de l\u2019espace aménagé'+(R.lv>=2 ? ', puis le coût du gazon à '+pg+' F CFA le m².' : '.')],
    corrige: [
      'Carré : '+c+' × '+c+' = '+fr(aC)+' m² ; rectangle : '+L+' × '+l+' = '+fr(aR)+' m².',
      'Triangle : ('+b+' × '+h+') ÷ 2 = '+fr(aT)+' m².',
      fr(aC)+' + '+fr(aR)+' + '+fr(aT)+' = '+fr(aC+aR+aT)+' m²'+(R.lv>=2 ? ' ; coût : '+fr(aC+aR+aT)+' × '+pg+' = '+fr(rnd((aC+aR+aT)*pg))+' F CFA.' : '.')
    ]
  };
}
gAires.kw = [/\baire/g,/surface/g,/carre/g,/rectangle/g,/triangle/g,/superficie/g];

function gPerim(R){
  var c = R.pick([10,12,15,20,25]), L = R.pick([30,40,50,60]), l = R.pick([15,20,25]), r = R.pick([5,7,10,14]);
  var pC = 4*c, pR = 2*(L+l), pO = rnd(2*3.14*r), pg = R.pick([100,150,200]);
  return {
    ctx: 'L\u2019école clôture ensuite un espace composé de trois parties de formes différentes.',
    tags: 'perimetre',
    intro: 'L\u2019espace comprend un carré de '+c+' m de côté, un rectangle de '+L+' m de longueur et de '+l+' m de largeur, puis un bassin en forme de cercle de '+r+' m de rayon.',
    figureHtml: shapesSvg([{k:'carre',c:c},{k:'rect',L:L,l:l},{k:'cercle',r:r}]),
    questions: ['Calcule le périmètre du carré et celui du rectangle.','Calcule la circonférence du cercle (prends \u03c0 = 3,14).','Détermine la longueur totale de grillage nécessaire pour entourer les trois parties'+(R.lv>=2 ? ', puis son coût à '+pg+' F CFA le mètre.' : '.')],
    corrige: [
      'Carré : 4 × '+c+' = '+pC+' m ; rectangle : 2 × ('+L+' + '+l+') = '+pR+' m.',
      'Cercle : 2 × 3,14 × '+r+' = '+fr(pO)+' m.',
      pC+' + '+pR+' + '+fr(pO)+' = '+fr(pC+pR+pO)+' m'+(R.lv>=2 ? ' ; coût : '+fr(rnd(pC+pR+pO))+' × '+pg+' = '+fr(rnd((pC+pR+pO)*pg))+' F CFA.' : '.')
    ]
  };
}
gPerim.kw = [/perimetre/g,/cercle/g,/circonference/g,/disque/g,/contour/g];

/* Questions « nombres et mesures » (3 par item, une par générateur) */
function qVolume(R, texte){
  var L = R.pick([2,3,4,5]), l = R.pick([1,1.5,2,2.5]), h = R.pick([1,1.2,1.5,2]);
  var v = rnd(L*l*h), cap = /capacit/.test(texte);
  return {
    ctx: 'Elle installe aussi une cuve pour disposer d\u2019une réserve d\u2019eau.',
    intro: 'La cuve installée a la forme d\u2019un pavé droit. Elle mesure '+fr(L)+' m de longueur, '+fr(l)+' m de largeur et '+fr(h)+' m de hauteur.',
    q: cap ? 'Calcule la capacité de la cuve en litres.' : 'Calcule le volume de la cuve en mètres cubes.',
    a: fr(L)+' × '+fr(l)+' × '+fr(h)+' = '+fr(v)+' m³'+(cap ? ' = '+fr(rnd(v*1000))+' L.' : '.')
  };
}
qVolume.kw = [/volume/g,/pave/g,/capacit/g,/cube/g,/litre/g];
qVolume.first = true;

function qDecimaux(R){
  var items = [];
  var n1 = R.int(1,9), n2 = R.int(11,99), n3 = R.int(101,999);
  while(n2%10===0) n2 = R.int(11,99);
  while(n3%10===0) n3 = R.int(101,999);
  var fr3 = [[n1,10,1],[n2,100,2],[n3,1000,3]];
  var ans = fr3.map(function(f){ return f[0]+'/'+f[1]+' = '+(f[0]/f[1]).toFixed(f[2]).replace('.',','); });
  return {
    q: 'Écris les fractions suivantes sous forme de nombres décimaux :\n'+fr3.map(function(f){ return '\u2022 '+f[0]+'/'+f[1]; }).join('\n'),
    a: ans.join(' ; ')+'.'
  };
}
qDecimaux.kw = [/fraction/g,/decimal/g];

function qEncadrer(R){
  var e = R.int(1,19), d = R.int(1,9), x = e+d/10, xs = String(x).replace('.',',');
  return { q: 'Encadre '+xs+' entre deux nombres entiers consécutifs.', a: e+' < '+xs+' < '+(e+1)+'.' };
}
qEncadrer.kw = [/encadr/g,/decimal/g,/entier/g,/comparer/g,/ranger/g];

function qFractionDe(R){
  var b = R.pick([2,3,4,5,10]), a = R.int(1,b-1), N = b*R.pick([10,20,30,40,50]);
  return {
    ctx: 'Les organisateurs prévoient également des gobelets pour les participants.',
    q: 'Calcule les '+a+'/'+b+' de '+N+' gobelets.',
    a: N+' ÷ '+b+' × '+a+' = '+(N/b*a)+' gobelets.'
  };
}
qFractionDe.kw = [/fraction/g,/\bde\b.*nombre/g];

var UN_LONG = [['km',3],['hm',2],['dam',1],['m',0],['dm',-1],['cm',-2],['mm',-3]];
var UN_MASSE = [['kg',3],['hg',2],['dag',1],['g',0],['dg',-1],['cg',-2],['mg',-3]];
var UN_CAP = [['hL',2],['daL',1],['L',0],['dL',-1],['cL',-2],['mL',-3]];
function qConversion(R){
  var rows = [], ans = [];
  [UN_LONG, UN_MASSE, UN_CAP].forEach(function(fam){
    var i = R.int(0,fam.length-1), j = R.int(0,fam.length-1), tries = 0;
    while((i===j || Math.abs(fam[i][1]-fam[j][1])>3) && tries++<50){ i = R.int(0,fam.length-1); j = R.int(0,fam.length-1); }
    var v = R.pick([2,3,4,5,6,7,8,12,15,25,0.5,1.5,2.5,3.5]);
    var res = rnd(v*Math.pow(10, fam[i][1]-fam[j][1]));
    rows.push('\u2022 '+fr(v)+' '+fam[i][0]+' = … '+fam[j][0]);
    ans.push(fr(v)+' '+fam[i][0]+' = '+fr(res)+' '+fam[j][0]);
  });
  return { q: 'Convertis :\n'+rows.join('\n'), a: ans.join(' ; ')+'.' };
}
qConversion.kw = [/mesure/g,/conversion/g,/longueur/g,/masse/g,/capacit/g,/unite/g];

function qDuree(R){
  var h = R.int(8,15), m = R.pick([0,15,30,45]), dh = R.int(1,3), dm = R.pick([20,30,45,50]);
  var t = h*60+m+dh*60+dm, eh = Math.floor(t/60), em = t%60;
  function hm(a,b){ return a+' h'+(b?' '+b+' min':''); }
  return { q: 'Le spectacle commence à '+hm(h,m)+' et dure '+hm(dh,dm)+'. À quelle heure se termine-t-il ?', a: hm(h,m)+' + '+hm(dh,dm)+' = '+hm(eh,em)+'.' };
}
qDuree.kw = [/duree/g,/heure/g,/temps/g,/horaire/g];

function qOperations(R){
  var a = rnd(R.int(50,250)/10), b = rnd(R.int(11,99)/100);
  var c = R.int(100,300)/10, d = rnd(R.int(11,99)/10);
  var e = R.pick([1.5,2.5,3.5,4.5]), f = R.pick([4,6,8]);
  return {
    q: 'Calcule :\n\u2022 '+fr(a)+' + '+fr(b)+'\n\u2022 '+fr(c)+' \u2212 '+fr(d)+'\n\u2022 '+fr(e)+' × '+f,
    a: fr(a)+' + '+fr(b)+' = '+fr(a+b)+' ; '+fr(c)+' \u2212 '+fr(d)+' = '+fr(c-d)+' ; '+fr(e)+' × '+f+' = '+fr(e*f)+'.'
  };
}
qOperations.kw = [/addition/g,/soustraction/g,/multiplication/g,/division/g,/operation/g,/decimaux/g,/calcul/g];

var recentGens = [];   // exercices du dernier tirage : pénalisés pour qu'une régénération ne redonne pas les mêmes
function score(g, text, R){
  var s = recentGens.indexOf(g)>=0 ? -2.5 : 0;
  (g.kw||[]).forEach(function(re){ var m = text.match(re); if(m) s += Math.min(m.length,3); });
  return s + R.n()*2.4;   // bruit fort : à SA identiques, deux enseignants n'obtiennent pas les mêmes exercices
}
function best(list, text, R){
  var sc = list.map(function(g){ return { g:g, s:score(g,text,R) }; });
  sc.sort(function(a,b){ return b.s-a.s; });
  return sc[0].g;
}

var EVENTS = ['une journée récréative','la fête de fin d\u2019année','une journée de sport','une kermesse scolaire','la journée de l\u2019école propre','une exposition de travaux d\u2019élèves','la journée portes ouvertes de l\u2019école','un tournoi inter-classes','la fête de la Journée de l\u2019enfant africain','une sortie pédagogique','la rentrée des classes','une campagne de reboisement de la cour','une journée du jardin scolaire','la cérémonie de remise des prix']

/* ------------------------------------------------------------------ */
/* Outils communs aux classes                                          */
/* ------------------------------------------------------------------ */
var GARCONS = ['Koffi','Comlan','Dossou','Codjo','Armand','Basile','Gildas','Séraphin','Kokou','Habib','Moussa','Samuel'];
var FILLES = ['Afi','Sènami','Fifamè','Adjoa','Aïcha','Mariam','Estelle','Nadège','Prisca','Judith','Rachidatou','Sabine'];
var U19 = ['zéro','un','deux','trois','quatre','cinq','six','sept','huit','neuf','dix','onze','douze','treize','quatorze','quinze','seize','dix-sept','dix-huit','dix-neuf'];
var DIZ = ['','','vingt','trente','quarante','cinquante','soixante'];
function mot(n){
  if(n<20) return U19[n];
  var d = Math.floor(n/10), u = n%10;
  if(n<70) return DIZ[d] + (u===1 ? ' et un' : (u ? '-'+U19[u] : ''));
  if(n<80){ u = n-60; return 'soixante' + (u===11 ? ' et onze' : '-'+U19[u]); }
  if(n<100){ u = n-80; return 'quatre-vingt' + (u ? '-'+U19[u] : 's'); }
  return n===100 ? 'cent' : String(n);
}
function distinct(R,k,lo,hi){ var out = [], t = 0; while(out.length<k && t++<800){ var v = R.int(lo,hi); if(out.indexOf(v)<0) out.push(v); } return out; }
function lvSpan(R,a,b,c){ return R.lv===1 ? a : (R.lv===2 ? b : c); }
function asc(a,b){ return a-b; }

/* Rangées de figures à dénombrer (CI) */
function iconsSvg(rows){
  var o = '', h = rows.length*38+10;
  rows.forEach(function(r,i){
    var y = 24+i*38;
    for(var k=0;k<r.n;k++){
      var x = 24+k*30;
      if(r.k==='rond') o += '<circle cx="'+x+'" cy="'+y+'" r="11" fill="'+FILL+'" stroke="'+INK+'" stroke-width="2"/>';
      else if(r.k==='carre') o += '<rect x="'+(x-11)+'" y="'+(y-11)+'" width="22" height="22" fill="'+FILL+'" stroke="'+INK+'" stroke-width="2"/>';
      else o += '<polygon points="'+x+','+(y-12)+' '+(x-12)+','+(y+11)+' '+(x+12)+','+(y+11)+'" fill="'+FILL+'" stroke="'+INK+'" stroke-width="2"/>';
    }
  });
  return sv(450,h,o,450);
}

/* ------------------------------------------------------------------ */
/* CI : nombres jusqu'à 20-30, dénombrement, calcul très simple        */
/* ------------------------------------------------------------------ */
function gCompterCI(R){
  var c = distinct(R,3,2,lvSpan(R,6,8,10));
  var kinds = [['rond','ronds'],['carre','carrés'],['tri','triangles']];
  var imax = c.indexOf(Math.max.apply(null,c)), s = c[0]+c[1]+c[2];
  return {
    ctx: 'La maîtresse prépare des figures découpées pour un jeu de classement.',
    intro: 'Voici les figures préparées par la maîtresse :',
    figureHtml: iconsSvg(kinds.map(function(k,i){ return { n:c[i], k:k[0] }; })),
    questions: ['Compte les ronds, les carrés et les triangles. Écris chaque nombre.','Quelle figure y a-t-il en plus grand nombre ?','Combien de figures y a-t-il en tout ? Écris l’opération.'],
    corrige: ['ronds : '+c[0]+' ; carrés : '+c[1]+' ; triangles : '+c[2]+'.','Il y a plus de '+kinds[imax][1]+' ('+c[imax]+').',c[0]+' + '+c[1]+' + '+c[2]+' = '+s+'.']
  };
}
gCompterCI.kw = [/compter/g,/denombr/g,/nombre/g,/figure/g,/dessin/g];

function gProblemeCI(R){
  var top = lvSpan(R,10,15,20), g = R.pick(GARCONS), f = R.pick(FILLES);
  var a = R.int(2,top-3), b = R.int(1,top-a), c = R.int(5,top), d = R.int(1,c-1), e = R.int(1,top-2), h = R.int(e+1,top);
  return {
    ctx: 'Les élèves jouent ensuite aux billes pendant la récréation.',
    intro: g+' a '+a+' billes. Il en gagne '+b+'. '+f+' a '+c+' billes ; elle en perd '+d+'.',
    questions: ['Combien de billes '+g+' a-t-il maintenant ? Écris l’opération.','Combien de billes reste-t-il à '+f+' ? Écris l’opération.','Complète : '+e+' + … = '+h+'.'],
    corrige: [a+' + '+b+' = '+(a+b)+' billes.',c+' − '+d+' = '+(c-d)+' billes.',e+' + '+(h-e)+' = '+h+'.']
  };
}
gProblemeCI.kw = [/addition/g,/soustraction/g,/calcul/g,/probleme/g,/ajouter/g,/retrancher/g];

function qCIEcrire(R){
  var hi = lvSpan(R,16,20,30), n1 = R.int(11,hi-1), n2 = R.int(11,hi);
  while(n2===n1) n2 = R.int(11,hi);
  return { q:'Écris en chiffres : '+mot(n1)+' ; '+mot(n2)+'.', a: mot(n1)+' = '+n1+' ; '+mot(n2)+' = '+n2+'.' };
}
qCIEcrire.kw = [/ecri/g,/lettre/g,/chiffre/g,/nombre/g];
function qCIRanger(R){
  var hi = lvSpan(R,12,20,30), l = distinct(R,4,1,hi);
  return { q:'Range du plus petit au plus grand : '+l.join(' ; ')+'.', a: l.slice().sort(asc).join(' < ')+'.' };
}
qCIRanger.kw = [/rang/g,/ordre/g,/compar/g,/nombre/g];
function qCISuite(R){
  var hi = lvSpan(R,14,20,30), s = R.int(0,hi-5), idx = distinct(R,2,1,4).sort(asc), t = [];
  for(var i=0;i<6;i++) t.push(idx.indexOf(i)>=0 ? '…' : String(s+i));
  return { q:'Complète la suite des nombres : '+t.join(' ; ')+'.', a:'Les nombres manquants sont '+(s+idx[0])+' et '+(s+idx[1])+'.' };
}
qCISuite.kw = [/suite/g,/compter/g,/nombre/g];
function qCIPlace(R){
  var hi = lvSpan(R,12,20,30), n = R.int(1,hi-2), m = R.int(2,hi);
  return { q:'Quel nombre vient juste après '+n+' ? Quel nombre vient juste avant '+m+' ?', a:'Après '+n+' : '+(n+1)+' ; avant '+m+' : '+(m-1)+'.' };
}
qCIPlace.kw = [/apres/g,/avant/g,/nombre/g,/suivant/g];
function qCIExtremes(R){
  var l = distinct(R,3,1,lvSpan(R,12,20,30)), s = l.slice().sort(asc);
  return { q:'Écris le plus petit et le plus grand de ces nombres : '+l.join(' ; ')+'.', a:'Le plus petit : '+s[0]+' ; le plus grand : '+s[2]+'.' };
}
qCIExtremes.kw = [/compar/g,/plus grand/g,/plus petit/g,/nombre/g];

/* ------------------------------------------------------------------ */
/* CP : nombres jusqu'à 100, dizaines et unités, calculs sans/avec retenue */
/* ------------------------------------------------------------------ */
function gNombresCP(R){
  var hi = lvSpan(R,59,79,99), n = R.int(21,hi);
  while(n%10===0) n = R.int(21,hi);
  var t = Math.floor(n/10), u = n%10, x = R.int(10,hi), y = R.int(10,hi), z = R.int(10,hi), w = R.int(10,hi);
  while(y===x) y = R.int(10,hi);
  while(w===z) w = R.int(10,hi);
  var four = distinct(R,4,10,hi);
  function cmp(a,b){ return a+' '+(a>b?'>':'<')+' '+b; }
  return {
    ctx: 'Les élèves du CP comptent ensuite le matériel de la classe.',
    intro: 'La bibliothèque de l’école compte '+n+' livres.',
    questions: ['Décompose '+n+' en dizaines et en unités.','Compare avec < ou > : '+x+' … '+y+' ; '+z+' … '+w+'.','Range du plus petit au plus grand : '+four.join(' ; ')+'.'],
    corrige: [n+' = '+t+' dizaines et '+u+' unité'+(u>1?'s':'')+'.',cmp(x,y)+' ; '+cmp(z,w)+'.',four.slice().sort(asc).join(' < ')+'.']
  };
}
gNombresCP.kw = [/nombre/g,/dizaine/g,/unite/g,/compar/g,/rang/g,/decompos/g];

function gOpsCP(R){
  var fruit = R.pick(['mangues','oranges','œufs','tomates']), a, b, c, d;
  if(R.lv===1){ a = R.int(2,5)*10+R.int(1,5); b = R.int(1,9-a%10); c = R.int(3,7)*10+R.int(4,9); d = R.int(1,c%10); }
  else { a = R.int(25,69); b = R.int(12,Math.min(40,99-a)); c = R.int(40,99); d = R.int(11,Math.min(39,c-1)); }
  var N = R.int(40,99), M = R.int(11,N-5);
  return {
    ctx: 'Au marché, une marchande compte ses fruits.',
    intro: 'Pour préparer la vente, la marchande range ses '+fruit+'.',
    questions: ['Pose et calcule : '+a+' + '+b,'Pose et calcule : '+c+' − '+d,'La marchande a '+N+' '+fruit+'. Elle en vend '+M+'. Combien lui en reste-t-il ?'],
    corrige: [a+' + '+b+' = '+(a+b)+'.',c+' − '+d+' = '+(c-d)+'.',N+' − '+M+' = '+(N-M)+' '+fruit+'.']
  };
}
gOpsCP.kw = [/addition/g,/soustraction/g,/calcul/g,/probleme/g,/retenue/g,/operation/g];

function qCPMonnaie(R){
  var p1 = R.pick([25,30,35,40,45,50]), p2 = R.pick([10,15,20,25]);
  return { q:'Un cahier coûte '+p1+' F et un stylo coûte '+p2+' F. Quel est le prix des deux articles ?', a: p1+' + '+p2+' = '+(p1+p2)+' F.' };
}
qCPMonnaie.kw = [/monnaie/g,/franc/g,/prix/g,/achat/g,/piece/g];
function qCPFigures(R){
  var c = R.pick([3,4,5,6]), L = R.pick([6,8,9]), l = R.pick([3,4,5]);
  return {
    figureHtml: shapesSvg([{k:'carre',c:c,u:'cm'},{k:'rect',L:L,l:l,u:'cm'},{k:'tri',b:R.pick([4,5,6]),h:R.pick([3,4,5]),u:'cm'}]),
    q:'Nomme les trois figures dessinées et dis combien de côtés a chacune.',
    a:'Carré : 4 côtés ; rectangle : 4 côtés ; triangle : 3 côtés.'
  };
}
qCPFigures.kw = [/figure/g,/carre/g,/rectangle/g,/triangle/g,/geometr/g,/cote/g];
function qCPSuite(R){
  var step = R.pick([2,5,10]), s = step*R.int(1,4), t = [], v = [];
  for(var i=0;i<5;i++) v.push(s+i*step);
  var m = distinct(R,2,1,4).sort(asc);
  v.forEach(function(x,i){ t.push(m.indexOf(i)>=0 ? '…' : String(x)); });
  return { q:'Complète la suite de '+step+' en '+step+' : '+t.join(' ; ')+'.', a:'Les nombres manquants sont '+v[m[0]]+' et '+v[m[1]]+'.' };
}
qCPSuite.kw = [/suite/g,/compter/g,/de 2 en 2/g,/de 5 en 5/g,/de 10 en 10/g,/nombre/g];
function qCPDouble(R){
  var x = R.int(5,lvSpan(R,20,30,45)), y = 2*R.int(5,lvSpan(R,15,20,25));
  return { q:'Calcule le double de '+x+' et la moitié de '+y+'.', a:'Le double de '+x+' est '+(2*x)+' ; la moitié de '+y+' est '+(y/2)+'.' };
}
qCPDouble.kw = [/double/g,/moitie/g,/calcul/g];
function qCPLettres(R){
  var a = R.int(21,69), b = R.int(70,99);
  return { q:'Écris en lettres : '+a+' ; '+b+'.', a: a+' : '+mot(a)+' ; '+b+' : '+mot(b)+'.' };
}
qCPLettres.kw = [/lettre/g,/ecri/g,/nombre/g];

/* ------------------------------------------------------------------ */
/* CE1 : nombres jusqu'à 999, opérations posées, multiplication, mesures */
/* ------------------------------------------------------------------ */
function gNombresCE1(R, tn){
  var big = /10[ .\u00a0]?000/.test(tn||'') ? 1 : 0;   // SA « nombres de 0 à 10 000 » cochée
  var hi = big ? 9899 : lvSpan(R,599,799,999), n = R.int(big ? 1021 : 121,hi);
  while(n%10===0 || (Math.floor(n/10)%10)===0) n = R.int(big ? 1021 : 121,hi);
  var c = big ? Math.floor(n/100)%10 : Math.floor(n/100), d = Math.floor(n/10)%10, u = n%10, mi = Math.floor(n/1000);
  var four = distinct(R,4,big ? 1001 : 101,hi);
  var step = R.pick(R.lv===1 ? [10] : [10,100]), s = step===10 ? R.int(10,90)*10 : R.int(1,5)*100, v = [];
  for(var i=0;i<5;i++) v.push(s+i*step);
  var m = distinct(R,2,1,4).sort(asc), t = v.map(function(x,i){ return m.indexOf(i)>=0 ? '…' : String(x); });
  return {
    ctx: 'Le directeur fait ensuite le compte du matériel de l’école.',
    intro: 'L’école possède '+n+' briques pour construire un mur.',
    questions: ['Décompose '+n+' en '+(big?'milliers, ':'')+'centaines, dizaines et unités.','Range du plus petit au plus grand : '+four.join(' ; ')+'.','Complète la suite de '+step+' en '+step+' : '+t.join(' ; ')+'.'],
    corrige: [n+' = '+(big ? mi+' millier'+(mi>1?'s':'')+', ' : '')+c+' centaine'+(c>1?'s':'')+', '+d+' dizaine'+(d>1?'s':'')+' et '+u+' unité'+(u>1?'s':'')+'.',four.slice().sort(asc).join(' < ')+'.','Les nombres manquants sont '+v[m[0]]+' et '+v[m[1]]+'.']
  };
}
gNombresCE1.kw = [/nombre/g,/centaine/g,/dizaine/g,/decompos/g,/rang/g,/suite/g];

function gOpsCE1(R){
  var a, b, c, d;
  if(R.lv===1){ a = R.int(111,444); b = R.int(111,444); c = R.int(500,899); d = R.int(101,c-100); }
  else { a = R.int(245,649); b = R.int(135,Math.min(349,999-a)); c = R.int(500,999); d = R.int(121,c-60); }
  var m = R.pick(R.lv===1 ? [5,6,8,10] : [6,8,10,12,15]), k = R.pick([3,4,5,6]), T = m*k, v = R.int(5,T-5);
  var fruit = R.pick(['mangues','oranges','bananes']);
  var qC = R.lv===3 ? 'Un sac contient '+m+' '+fruit+'. Un commerçant achète '+k+' sacs puis vend '+v+' '+fruit+'. Combien lui en reste-t-il ?'
                    : 'Un sac contient '+m+' '+fruit+'. Combien y a-t-il de '+fruit+' dans '+k+' sacs ?';
  return {
    ctx: 'Au marché, un commerçant fait ses comptes.',
    intro: 'Un commerçant prépare ses ventes de la journée.',
    questions: ['Pose et effectue : '+a+' + '+b,'Pose et effectue : '+c+' − '+d,qC],
    corrige: [a+' + '+b+' = '+(a+b)+'.',c+' − '+d+' = '+(c-d)+'.',R.lv===3 ? k+' × '+m+' = '+T+' ; '+T+' − '+v+' = '+(T-v)+' '+fruit+'.' : k+' × '+m+' = '+T+' '+fruit+'.']
  };
}
gOpsCE1.kw = [/addition/g,/soustraction/g,/multiplication/g,/calcul/g,/operation/g,/probleme/g,/retenue/g];

function qCE1Mesure(R){
  var x = R.int(2,9), y = R.int(2,9), z = R.int(15,95);
  return { q:'Convertis :\n• '+x+' m = … cm\n• '+(y*100)+' cm = … m\n• '+z+' dm = … cm', a: x+' m = '+(x*100)+' cm ; '+(y*100)+' cm = '+y+' m ; '+z+' dm = '+(z*10)+' cm.' };
}
qCE1Mesure.kw = [/mesure/g,/longueur/g,/metre/g,/convert/g,/centimetre/g];
function qCE1Heure(R){
  var h = R.int(7,15), d = R.int(1,3), m = R.pick([0,30]);
  function hm(a,b){ return a+' h'+(b?' '+b+' min':''); }
  return { q:'Le spectacle commence à '+hm(h,m)+' et dure '+d+' heure'+(d>1?'s':'')+'. À quelle heure finit-il ?', a: hm(h,m)+' + '+d+' h = '+hm(h+d,m)+'.' };
}
qCE1Heure.kw = [/heure/g,/duree/g,/temps/g,/horloge/g];
function qCE1Double(R){
  var x = R.int(11,lvSpan(R,40,60,95)), y = 2*R.int(15,lvSpan(R,30,40,49));
  return { q:'Calcule le double de '+x+' et la moitié de '+y+'.', a:'Le double de '+x+' est '+(2*x)+' ; la moitié de '+y+' est '+(y/2)+'.' };
}
qCE1Double.kw = [/double/g,/moitie/g,/calcul/g];
function qCE1Monnaie(R){
  var p1 = R.pick([75,100,125,150]), p2 = R.pick([25,50,60]), pay = R.pick([200,250,500]);
  return { q:'Tu achètes un cahier à '+p1+' F et un stylo à '+p2+' F. Tu paies avec '+pay+' F. Combien le commerçant te rend-il ?', a: p1+' + '+p2+' = '+(p1+p2)+' F ; '+pay+' − '+(p1+p2)+' = '+(pay-p1-p2)+' F.' };
}
qCE1Monnaie.kw = [/monnaie/g,/franc/g,/prix/g,/achat/g,/piece/g,/billet/g];
function qCE1Figures(R){
  var c = R.pick([3,4,5,6,8]), L = R.pick([6,8,10]), l = R.pick([3,4,5]);
  return {
    figureHtml: shapesSvg([{k:'carre',c:c,u:'cm'},{k:'rect',L:L,l:l,u:'cm'},{k:'tri',b:R.pick([4,5,6]),h:R.pick([3,4,5]),u:'cm'}]),
    q:'Nomme les figures dessinées, puis calcule le périmètre du carré et celui du rectangle.',
    a:'Carré, rectangle, triangle. Carré : '+c+' + '+c+' + '+c+' + '+c+' = '+(4*c)+' cm ; rectangle : '+L+' + '+l+' + '+L+' + '+l+' = '+(2*(L+l))+' cm.'
  };
}
qCE1Figures.kw = [/figure/g,/carre/g,/rectangle/g,/triangle/g,/perimetre/g,/geometr/g];

/* ------------------------------------------------------------------ */
/* CE2 : nombres jusqu'à 9 999, opérations posées, monnaie, partage     */
/* ------------------------------------------------------------------ */
function gNombresCE2(R, tn){
  var big = /999[ .\u00a0]?999/.test(tn||'') ? 2 : (/100[ .\u00a0]?000/.test(tn||'') ? 1 : 0);   // étendue des nombres de la SA cochée
  var hi = big===2 ? 987654 : (big===1 ? 98765 : lvSpan(R,5999,7999,9999)), n = R.int(big ? 10101 : 1201,hi);
  while(n%10===0) n = R.int(big ? 10101 : 1201,hi);
  var mi = Math.floor(n/1000), c = Math.floor(n/100)%10, d = Math.floor(n/10)%10, u = n%10;
  var four = distinct(R,4,1001,hi), e = R.int(1101,hi);
  while(e%100===0) e = R.int(1101,hi);
  var h = Math.floor(e/100)*100;
  function pl(k,s){ return k+' '+s+(k>1?'s':''); }
  var bm = R.int(2,9), bc = R.int(2,9), bu = R.int(2,9), m0 = R.int(2,7)*1000+R.int(1,9)*100, ac = R.int(3,8);
  var xa = R.int(2,8), xb = R.int(1,9), xc = R.int(1,9);
  var cx = xa*1000+xb*100+xc*10, cy = (xb!==xc) ? xa*1000+xc*100+xb*10 : cx+10;   // mêmes chiffres permutés : comparaison fine
  return {
    ctx: 'Le comité de gestion compte ensuite les participants et le matériel.',
    intro: 'Pendant l’année, '+fr(n)+' visiteurs ont fréquenté la bibliothèque du village.',
    questions: ['Décompose '+fr(n)+' en milliers, centaines, dizaines et unités.','Range du plus grand au plus petit : '+four.map(fr).join(' ; ')+'.','Encadre '+fr(e)+' entre deux centaines consécutives.'].concat(R.lv>=3 ? [
      'Écris en chiffres le nombre formé de '+bm+' milliers, '+bc+' centaines et '+bu+' unités.',
      'Quel nombre obtient-on en ajoutant '+ac+' centaines à '+fr(m0)+', puis en retirant 1 millier ?',
      'Compare avec <, > ou = : '+fr(cx)+' … '+fr(cy)+'.'] : []),
    corrige: [fr(n)+' = '+pl(mi,'millier')+', '+pl(c,'centaine')+', '+pl(d,'dizaine')+' et '+pl(u,'unité')+'.',four.slice().sort(function(a,b){return b-a;}).map(fr).join(' > ')+'.',fr(h)+' < '+fr(e)+' < '+fr(h+100)+'.'].concat(R.lv>=3 ? [
      bm+' milliers + '+bc+' centaines + '+bu+' unités = '+fr(bm*1000+bc*100+bu)+'.',
      fr(m0)+' + '+(ac*100)+' = '+fr(m0+ac*100)+' ; '+fr(m0+ac*100)+' − 1 000 = '+fr(m0+ac*100-1000)+'.',
      fr(cx)+(cx>cy?' > ':(cx<cy?' < ':' = '))+fr(cy)+'.'] : [])
  };
}
gNombresCE2.kw = [/nombre/g,/millier/g,/centaine/g,/decompos/g,/rang/g,/encadr/g,/compar/g];

function gOpsCE2(R){
  var a = R.int(1245,lvSpan(R,3999,4999,5999)), b = R.int(1135,lvSpan(R,3999,4000,4000)), c = R.int(4500,9999), d = R.int(1235,c-300), x, y;
  if(R.lv<3){ x = R.int(112,lvSpan(R,299,499,799)); y = R.int(3,9); } else { x = R.int(21,48); y = R.int(12,29); }
  return {
    ctx: 'La coopérative scolaire fait ensuite ses comptes.',
    intro: 'La coopérative de l’école prépare son bilan de l’année.',
    questions: ['Pose et effectue : '+fr(a)+' + '+fr(b),'Pose et effectue : '+fr(c)+' − '+fr(d),'Pose et effectue : '+x+' × '+y].concat(R.lv>=3 ? [
      'Vérifie ta soustraction à l’aide d’une addition.',
      'Trouve le nombre manquant : '+fr(a)+' + … = '+fr(a+b)+'.',
      'La coopérative a '+fr(c)+' F en caisse. Elle dépense '+fr(d)+' F, puis encaisse '+fr(a)+' F. Combien a-t-elle en caisse à la fin ?'] : []),
    corrige: [fr(a)+' + '+fr(b)+' = '+fr(a+b)+'.',fr(c)+' − '+fr(d)+' = '+fr(c-d)+'.',x+' × '+y+' = '+fr(x*y)+'.'].concat(R.lv>=3 ? [
      fr(c-d)+' + '+fr(d)+' = '+fr(c)+'.',
      fr(a+b)+' − '+fr(a)+' = '+fr(b)+'.',
      fr(c)+' − '+fr(d)+' = '+fr(c-d)+' ; '+fr(c-d)+' + '+fr(a)+' = '+fr(c-d+a)+' F.'] : [])
  };
}
gOpsCE2.kw = [/addition/g,/soustraction/g,/multiplication/g,/calcul/g,/operation/g,/retenue/g];

function gAchatsCE2(R){
  var art = R.pick([['cahier','cahiers'],['stylo','stylos'],['sachet de biscuits','sachets de biscuits']]);
  var p = R.pick([75,100,125,150,200,250]), n = R.int(3,lvSpan(R,6,8,12)), pay = Math.ceil((p*n+1)/500)*500, k = R.int(4,9), j = R.int(2,5), q = R.pick([50,75,100]);
  return {
    ctx: 'Les élèves achètent des fournitures pour la fête de l’école.',
    intro: 'Un '+art[0]+' coûte '+fr(p)+' F. Une élève achète '+n+' '+art[1]+' et paie avec '+fr(pay)+' F.',
    questions: ['Calcule le prix de '+n+' '+art[1]+'.','Combien le commerçant lui rend-il ?','Avec '+fr(p*k)+' F, combien de '+art[1]+' peut-on acheter ?'].concat(R.lv>=3 ? [
      'Elle achète en plus '+j+' stylos à '+fr(q)+' F l’un. Quel est le prix total de tous ses achats ?'] : []),
    corrige: [n+' × '+fr(p)+' = '+fr(n*p)+' F.',fr(pay)+' − '+fr(n*p)+' = '+fr(pay-n*p)+' F.',fr(p*k)+' ÷ '+fr(p)+' = '+k+' '+art[1]+'.'].concat(R.lv>=3 ? [
      j+' × '+fr(q)+' = '+fr(j*q)+' F ; '+fr(n*p)+' + '+fr(j*q)+' = '+fr(n*p+j*q)+' F.'] : [])
  };
}
gAchatsCE2.kw = [/monnaie/g,/franc/g,/prix/g,/achat/g,/probleme/g,/division/g,/multiplication/g];

function qCE2Mesures(R){
  var x = R.int(2,9), y = R.int(2,9), z = R.int(2,9);
  return { q:'Convertis :\n• '+x+' km = … m\n• '+y+' kg = … g\n• '+z+' L = … dL', a: x+' km = '+fr(x*1000)+' m ; '+y+' kg = '+fr(y*1000)+' g ; '+z+' L = '+(z*10)+' dL.' };
}
qCE2Mesures.kw = [/mesure/g,/longueur/g,/masse/g,/capacit/g,/convert/g,/kilometre/g];
function qCE2Perim(R){
  var L = R.pick([12,15,18,25]), l = R.pick([8,10,14]), c = R.pick([9,11,13,15]);
  return { q:'Calcule le périmètre d’un rectangle de '+L+' cm de longueur et '+l+' cm de largeur, puis celui d’un carré de '+c+' cm de côté.', a:'Rectangle : ('+L+' + '+l+') × 2 = '+(2*(L+l))+' cm ; carré : '+c+' × 4 = '+(4*c)+' cm.' };
}
qCE2Perim.kw = [/perimetre/g,/rectangle/g,/carre/g,/figure/g,/geometr/g];
function qCE2Fraction(R){
  var N = 4*R.int(5,lvSpan(R,15,25,50));
  return { q:'Un sac contient '+N+' bonbons. Calcule la moitié puis le quart du nombre de bonbons.', a:'Moitié : '+N+' ÷ 2 = '+(N/2)+' ; quart : '+N+' ÷ 4 = '+(N/4)+' bonbons.' };
}
qCE2Fraction.kw = [/fraction/g,/moitie/g,/quart/g];
function qCE2Partage(R){
  var k = R.int(3,9), q = R.int(6,25), r = R.int(1,k-1), N = R.lv===3 ? k*q+r : k*q;
  return {
    q:'On partage '+N+' mangues en parts égales entre '+k+' élèves. '+(R.lv===3 ? 'Combien chacun reçoit-il et combien en reste-t-il ?' : 'Combien chacun en reçoit-il ?'),
    a: N+' ÷ '+k+' = '+q+(R.lv===3 ? ' ; reste '+r+'.' : ' mangues.')
  };
}
qCE2Partage.kw = [/division/g,/partage/g,/probleme/g];

/* Thèmes du programme CE2 présents dans les résumés (dossiers 2 à 8) : angles, solides, monnaie / épargne, aire, tableau de données,
   plan quadrillé, symétrie, masse. Chaque exercice est choisi quand les titres des SA cochées le mentionnent. */
function qCE2Angles(R){
  var v = R.pick([[35,'aigu'],[90,'droit'],[120,'obtus'],[180,'plat'],[60,'aigu'],[150,'obtus'],[75,'aigu']]), w = R.pick([[110,'obtus'],[45,'aigu'],[90,'droit'],[180,'plat']]);
  return { q:'Un angle mesure '+v[0]+'° et un autre mesure '+w[0]+'°. Dis, pour chacun, s’il est aigu, droit, obtus ou plat, puis lequel est le plus grand.', a:v[0]+'° : angle '+v[1]+' ; '+w[0]+'° : angle '+w[1]+' ; le plus grand : '+(v[0]>=w[0]?v[0]:w[0])+'°.' };
}
qCE2Angles.kw = [/angle/g,/aigu/g,/obtus/g,/droit/g];
function qCE2Solides(R){
  var S = [['cube',6,12,8],['pavé droit',6,12,8],['prisme à base triangulaire',5,9,6],['pyramide à base carrée',5,8,5]], a = R.pick(S), b = R.pick(S.filter(function(x){ return x[0]!==a[0]; }));
  return { q:'Donne le nombre de faces, d’arêtes et de sommets d’un(e) '+a[0]+', puis d’un(e) '+b[0]+'.', a:a[0]+' : '+a[1]+' faces, '+a[2]+' arêtes, '+a[3]+' sommets ; '+b[0]+' : '+b[1]+' faces, '+b[2]+' arêtes, '+b[3]+' sommets.' };
}
qCE2Solides.kw = [/solide/g,/polyedre/g,/prisme/g,/pyramide/g,/cube/g,/pave/g,/arete/g,/face/g];
function qCE2Monnaie(R){
  var art = R.pick(['sac de riz','pagne','panier de tomates','paire de sandales']), n = R.int(3,9), pa = R.pick([1500,2000,2500,3000,3500]), perte = R.pick([0,1]);
  var vente = perte ? pa - R.pick([250,500]) : pa + R.pick([250,500,750]);
  return { q:'Une commerçante achète '+n+' '+art+'s à '+fr(pa)+' F l’un, puis les revend '+fr(vente)+' F l’un. Calcule le prix d’achat total, le prix de vente total, puis dis si elle réalise un bénéfice ou une perte et de combien.',
    a:'Achat : '+n+' × '+fr(pa)+' = '+fr(n*pa)+' F ; vente : '+n+' × '+fr(vente)+' = '+fr(n*vente)+' F ; '+(perte ? 'perte' : 'bénéfice')+' : '+fr(Math.abs(n*vente-n*pa))+' F.' };
}
qCE2Monnaie.kw = [/monnaie/g,/prix/g,/benefice/g,/perte/g,/credit/g,/epargne/g,/frais/g];
function qCE2Epargne(R){
  var d = R.pick([5000,7500,10000,12500]), m = R.pick([1000,1500,2000,2500]), n = R.int(3,8);
  return { q:'Awa possède '+fr(d)+' F à la caisse d’épargne. Chaque mois, elle y dépose '+fr(m)+' F. Combien aura-t-elle après '+n+' mois ?', a:fr(m)+' × '+n+' = '+fr(m*n)+' F ; '+fr(d)+' + '+fr(m*n)+' = '+fr(d+m*n)+' F.' };
}
qCE2Epargne.kw = [/epargne/g,/credit/g,/economie/g];
function qCE2Aire(R){
  var L = R.int(4,9), l = R.int(3,L-1);
  return { q:'Un rectangle est recouvert de '+L+' rangées de '+l+' carreaux. Combien de carreaux le recouvrent ? Quelle est son aire en carreaux ?', a:L+' × '+l+' = '+(L*l)+' carreaux ; l’aire est de '+(L*l)+' carreaux.' };
}
qCE2Aire.kw = [/aire/g,/pavage/g,/carreau/g,/surface/g];
function qCE2Tableau(R){
  var A = R.pick([['football','danse','dessin'],['lecture','chant','théâtre'],['course','saut','lancer']]), a = R.int(8,20), b = R.int(6,18), c = R.int(5,16), mx = Math.max(a,b,c), mn = Math.min(a,b,c), nm = [a,b,c];
  return { q:'Dans une classe, '+a+' élèves choisissent '+A[0]+', '+b+' choisissent '+A[1]+' et '+c+' choisissent '+A[2]+'. Présente ces données dans un tableau, calcule l’effectif total, puis nomme l’activité la plus choisie.',
    a:'Total : '+a+' + '+b+' + '+c+' = '+(a+b+c)+' élèves ; activité la plus choisie : '+A[nm.indexOf(mx)]+' ('+mx+' élèves), la moins choisie : '+A[nm.indexOf(mn)]+' ('+mn+' élèves).' };
}
qCE2Tableau.kw = [/tableau/g,/diagramme/g,/graphique/g,/donnee/g,/bande/g,/effectif/g];
function qCE2Plan(R){
  var col = R.int(1,3), lig = R.int(1,3), dx = R.int(2,4), dy = R.int(2,4), L = 'ABCDEFGH';
  return { q:'Sur un quadrillage, le point P est à la colonne '+L[col-1]+', ligne '+lig+'. Il se déplace de '+dx+' cases vers la droite, puis de '+dy+' cases vers le haut. Où arrive-t-il ? Code ce déplacement avec des flèches.',
    a:'Colonne '+L[col-1+dx]+', ligne '+(lig+dy)+' ; codage : '+new Array(dx+1).join('→ ')+new Array(dy+1).join('↑ ')+'.' };
}
qCE2Plan.kw = [/plan/g,/quadrill/g,/reper/g,/deplacement/g,/codage/g];
function qCE2Symetrie(R){
  var F = [['carré',4],['rectangle',2],['triangle équilatéral',3],['cercle','une infinité d’']], a = R.pick(F), b = R.pick(F.filter(function(x){ return x[0]!==a[0]; }));
  return { q:'Combien d’axes de symétrie possède un '+a[0]+' ? Et un '+b[0]+' ?', a:a[0]+' : '+a[1]+' axe(s) ; '+b[0]+' : '+b[1]+' axe(s).' };
}
qCE2Symetrie.kw = [/symetrie/g,/axe/g,/glissement/g];
function qCE2Masse(R){
  var k = R.int(2,9), sacs = R.int(3,8), g = R.pick([250,500,750]);
  return { q:'Convertis : '+k+' kg = … g. Un sac de riz pèse '+k+' kg. Quelle est, en kg puis en g, la masse de '+sacs+' sacs, avec en plus un paquet de '+g+' g ?',
    a:k+' kg = '+fr(k*1000)+' g ; '+sacs+' × '+k+' = '+(sacs*k)+' kg = '+fr(sacs*k*1000)+' g ; avec le paquet : '+fr(sacs*k*1000+g)+' g.' };
}
qCE2Masse.kw = [/masse/g,/kilogramme/g,/gramme/g,/peser/g,/pese/g];

/* ------------------------------------------------------------------ */
/* CM1 : grands nombres, aires, périmètres, fractions, décimaux         */
/* ------------------------------------------------------------------ */
function gPerimCM1(R){
  var c = R.pick([10,12,15,20,25]), L = R.pick([30,40,50,60]), l = R.pick([15,20,25]);
  var s1 = R.pick([12,15,18]), s2 = R.pick([16,20,24]), s3 = R.pick([20,25,30]), p = R.pick([100,150,200,250]);
  var pC = 4*c, pR = 2*(L+l), pT = s1+s2+s3, tot = pC+pR+pT;
  return {
    ctx: 'L’école clôture ensuite trois espaces de formes différentes.',
    tags: 'perimetre',
    intro: 'Les trois espaces sont : un carré de '+c+' m de côté, un rectangle de '+L+' m de longueur et de '+l+' m de largeur, puis un triangle dont les côtés mesurent '+s1+' m, '+s2+' m et '+s3+' m.',
    figureHtml: shapesSvg([{k:'carre',c:c},{k:'rect',L:L,l:l}]),
    questions: ['Calcule le périmètre du carré et celui du rectangle.','Calcule le périmètre du triangle.','Détermine la longueur totale de grillage nécessaire'+(R.lv>=2 ? ', puis son coût à '+p+' F CFA le mètre.' : '.')],
    corrige: ['Carré : 4 × '+c+' = '+pC+' m ; rectangle : 2 × ('+L+' + '+l+') = '+pR+' m.',s1+' + '+s2+' + '+s3+' = '+pT+' m.',pC+' + '+pR+' + '+pT+' = '+tot+' m'+(R.lv>=2 ? ' ; coût : '+tot+' × '+p+' = '+fr(tot*p)+' F CFA.' : '.')]
  };
}
gPerimCM1.kw = [/perimetre/g,/contour/g,/carre/g,/rectangle/g,/triangle/g];

function qOperationsCM1(R){
  var hi = lvSpan(R,99999,399999,499999), a = R.int(12345,hi), b = R.int(10234,hi), c = R.int(500000,999999), d = R.int(100234,c-1000);
  var e = R.int(112,lvSpan(R,499,799,999)), f = R.int(R.lv<3?3:12, R.lv<3?9:35);
  return {
    q:'Pose et effectue :\n• '+fr(a)+' + '+fr(b)+'\n• '+fr(c)+' − '+fr(d)+'\n• '+fr(e)+' × '+f,
    a: fr(a)+' + '+fr(b)+' = '+fr(a+b)+' ; '+fr(c)+' − '+fr(d)+' = '+fr(c-d)+' ; '+fr(e)+' × '+f+' = '+fr(e*f)+'.'
  };
}
qOperationsCM1.kw = [/addition/g,/soustraction/g,/multiplication/g,/division/g,/operation/g,/calcul/g,/grand/g,/nombre/g];

/* ------------------------------------------------------------------ */
/* Situations-problèmes à plusieurs étapes (CE1 → CM2) : ajoutées à      */
/* chaque épreuve pour qu'elle ne se limite jamais à des calculs directs */
/* ------------------------------------------------------------------ */
function who(R){ var f = R.n()<0.5; return { nm: R.pick(f ? FILLES : GARCONS), f: f }; }
function hmStr(a,b){ return a+' h'+(b ? ' '+b+' min' : ''); }

function qProbCE1Achat(R){
  var w = who(R), p = R.pick([50,75,100,150]), a = R.int(2,4), q = R.pick([25,50,75]), b = R.int(2,5);
  var tot = a*p+b*q, Z = Math.ceil((tot+25)/500)*500;
  return {
    q: w.nm+' achète '+a+' cahiers à '+fr(p)+' F l’un et '+b+' stylos à '+fr(q)+' F l’un. '+(w.f?'Elle':'Il')+' paie avec '+fr(Z)+' F. Combien d’argent lui rend-on ? Écris toutes tes opérations.',
    a: a+' × '+fr(p)+' = '+fr(a*p)+' F ; '+b+' × '+fr(q)+' = '+fr(b*q)+' F ; total : '+fr(a*p)+' + '+fr(b*q)+' = '+fr(tot)+' F ; on rend : '+fr(Z)+' − '+fr(tot)+' = '+fr(Z-tot)+' F.'
  };
}
qProbCE1Achat.kw = [/prix/g,/achat/g,/monnaie/g,/probleme/g,/franc/g,/multiplication/g,/addition/g,/soustraction/g];
function qProbCE1Paniers(R){
  var m = R.pick([5,10]), k = R.int(4,9), T = m*k, v = 5*R.int(1,Math.floor(T/5)-2), r = T-v;
  return {
    q: 'Une commerçante a '+k+' paniers de '+m+' mangues. Elle en vend '+v+'. Avec les mangues qui restent, elle fait des sachets de 5 mangues. Combien de sachets obtient-elle ? Écris toutes tes opérations.',
    a: k+' × '+m+' = '+T+' mangues ; '+T+' − '+v+' = '+r+' mangues ; '+r+' ÷ 5 = '+(r/5)+' sachets.'
  };
}
qProbCE1Paniers.kw = [/multiplication/g,/division/g,/probleme/g,/partage/g,/soustraction/g,/operation/g];

function qProbCE2Achat(R){
  var p1 = R.pick([250,350,400,450,500]), a = R.int(3,8), p2 = R.pick([75,125,150,200,225]), b = R.int(4,12);
  var tot = a*p1+b*p2, Z = Math.ceil((tot+50)/1000)*1000;
  return {
    q: 'Une école achète '+a+' cahiers à '+fr(p1)+' F l’un et '+b+' crayons à '+fr(p2)+' F l’un. Le directeur paie avec '+fr(Z)+' F. Quelle somme la caissière lui rend-elle ? Écris toutes tes opérations.',
    a: a+' × '+fr(p1)+' = '+fr(a*p1)+' F ; '+b+' × '+fr(p2)+' = '+fr(b*p2)+' F ; total : '+fr(a*p1)+' + '+fr(b*p2)+' = '+fr(tot)+' F ; on rend : '+fr(Z)+' − '+fr(tot)+' = '+fr(Z-tot)+' F.'
  };
}
qProbCE2Achat.kw = [/prix/g,/achat/g,/monnaie/g,/probleme/g,/franc/g,/multiplication/g,/addition/g,/soustraction/g];
function qProbCE2Bidons(R){
  var k = R.pick([5,8,10,12]), qn = R.int(12,60), r = R.int(1,k-1), N = k*qn+r, p = R.pick([50,100,150,200]);
  return {
    q: 'Un puits fournit '+fr(N)+' litres d’eau. On remplit des bidons de '+k+' litres. Combien de bidons pleins obtient-on et combien de litres restent-ils ? Chaque bidon plein est vendu '+fr(p)+' F : calcule la recette.',
    a: fr(N)+' ÷ '+k+' : '+qn+' bidons pleins, il reste '+r+' L ; recette : '+qn+' × '+fr(p)+' = '+fr(qn*p)+' F.'
  };
}
qProbCE2Bidons.kw = [/division/g,/capacit/g,/litre/g,/mesure/g,/probleme/g,/partage/g,/multiplication/g];
function qProbCE2Trajet(R){
  var h = R.int(6,14), m = R.pick([0,15,30,45]), dh = R.int(2,4), dm = R.pick([20,30,45,50]), arret = R.pick([15,20,30,40]);
  var t = h*60+m+dh*60+dm+arret;
  return {
    q: 'Un car quitte la gare à '+hmStr(h,m)+'. Le trajet dure '+hmStr(dh,dm)+' et le chauffeur fait un arrêt de '+arret+' minutes en route. À quelle heure le car arrive-t-il ?',
    a: hmStr(h,m)+' + '+hmStr(dh,dm)+' + '+arret+' min = '+hmStr(Math.floor(t/60),t%60)+'.'
  };
}
qProbCE2Trajet.kw = [/duree/g,/heure/g,/temps/g,/minute/g,/probleme/g,/mesure/g];

function qProbCM1Champ(R){
  var L = 10*R.int(4,12), l = 10*R.int(2,6), p = R.pick([250,300,400,500]), P = 2*(L+l), A = L*l;
  return {
    q: 'Un champ rectangulaire mesure '+L+' m de long et '+l+' m de large. 1) Calcule son périmètre, puis le coût du grillage pour le clôturer à '+fr(p)+' F le mètre. 2) Calcule son aire, puis le nombre de plants de manioc qu’on peut y mettre si chaque plant occupe 2 m².',
    a: 'Périmètre : 2 × ('+L+' + '+l+') = '+P+' m ; coût : '+P+' × '+fr(p)+' = '+fr(P*p)+' F. Aire : '+L+' × '+l+' = '+fr(A)+' m² ; plants : '+fr(A)+' ÷ 2 = '+fr(A/2)+'.'
  };
}
qProbCM1Champ.kw = [/perimetre/g,/aire/g,/surface/g,/rectangle/g,/geometr/g,/probleme/g,/mesure/g];
function qProbCM1Fraction(R){
  var N = 12*R.int(4,12), x = N/4, y = N/3;
  return {
    q: 'Un grossiste a '+N+' sacs de riz. Il en vend le quart le lundi et le tiers le mardi. Combien de sacs a-t-il vendus en tout ? Combien lui en reste-t-il ?',
    a: 'Lundi : '+N+' ÷ 4 = '+x+' sacs ; mardi : '+N+' ÷ 3 = '+y+' sacs ; vendus : '+x+' + '+y+' = '+(x+y)+' sacs ; reste : '+N+' − '+(x+y)+' = '+(N-x-y)+' sacs.'
  };
}
qProbCM1Fraction.kw = [/fraction/g,/quart/g,/tiers/g,/moitie/g,/probleme/g,/division/g];
function qProbCM1Prix(R){
  var pk = R.pick([400,500,600,800,1000]), m = R.pick([2.5,3.5,4.5]), tot = rnd(pk*m), k = R.int(6,12);
  return {
    q: fr(m)+' kg de tomates coûtent '+fr(tot)+' F. Calcule le prix d’un kilogramme, puis le prix de '+k+' kg de tomates.',
    a: fr(tot)+' ÷ '+fr(m)+' = '+fr(pk)+' F le kilogramme ; '+k+' × '+fr(pk)+' = '+fr(k*pk)+' F.'
  };
}
qProbCM1Prix.kw = [/decimaux/g,/prix/g,/proportion/g,/masse/g,/probleme/g,/division/g,/multiplication/g];

function qProbCM2Reduc(R){
  var P = 100*R.int(15,90), r = R.pick([10,15,20,25]), n = R.int(2,6), red = P*r/100, pay = P-red;
  return {
    q: 'Un commerçant affiche un sac à '+fr(P)+' F et accorde une réduction de '+r+' %. Calcule le montant de la réduction, le prix à payer pour un sac, puis le prix de '+n+' sacs.',
    a: 'Réduction : '+fr(P)+' × '+r+' ÷ 100 = '+fr(red)+' F ; prix d’un sac : '+fr(P)+' − '+fr(red)+' = '+fr(pay)+' F ; '+n+' sacs : '+n+' × '+fr(pay)+' = '+fr(n*pay)+' F.'
  };
}
qProbCM2Reduc.kw = [/pourcentage/g,/reduction/g,/proportion/g,/prix/g,/probleme/g,/%/g];
function qProbCM2Vitesse(R){
  var v = R.pick([12,16,18,20,24,30]), h = R.int(2,4), d = v*(h+0.5), D = d+10*R.int(2,8);
  return {
    q: 'Un cycliste roule à '+v+' km/h pendant '+hmStr(h,30)+'. Il doit parcourir '+D+' km au total. Quelle distance a-t-il déjà parcourue ? Quelle distance lui reste-t-il à parcourir ?',
    a: 'Distance parcourue : '+v+' × '+fr(h+0.5)+' = '+fr(d)+' km ; reste : '+D+' − '+fr(d)+' = '+fr(D-d)+' km.'
  };
}
qProbCM2Vitesse.kw = [/vitesse/g,/distance/g,/duree/g,/temps/g,/proportion/g,/probleme/g];
function qProbCM2Citerne(R){
  var a = R.int(2,5), b = R.int(2,4), c = R.int(2,3), V = a*b*c;
  return {
    q: 'Une citerne en forme de pavé droit mesure '+a+' m de long, '+b+' m de large et '+c+' m de haut. Calcule son volume en m³, puis sa capacité en litres (1 m³ = 1 000 L). Combien de fûts de 200 L peut-on remplir avec l’eau de la citerne pleine ?',
    a: 'Volume : '+a+' × '+b+' × '+c+' = '+V+' m³ = '+fr(V*1000)+' L ; fûts : '+fr(V*1000)+' ÷ 200 = '+(V*5)+' fûts.'
  };
}
qProbCM2Citerne.kw = [/volume/g,/capacit/g,/litre/g,/pave/g,/mesure/g,/probleme/g];


/* ------------------------------------------------------------------ */
/* Exercices par thème de SA — CE1, CM1, CM2 (d'après les résumés)    */
/* Chaque exercice est choisi quand les titres des SA cochées le      */
/* mentionnent (mots-clés .kw), sinon tirage au sort.                 */
/* ------------------------------------------------------------------ */
function fq(n,d){ var g = gcd(n,d); return g>1 ? (d/g===1 ? n+'/'+d+' = '+(n/g) : n+'/'+d+' = '+(n/g)+'/'+(d/g)) : n+'/'+d; }
function roman(n){ var t = [[10,'X'],[9,'IX'],[5,'V'],[4,'IV'],[1,'I']], o = ''; t.forEach(function(x){ while(n>=x[0]){ o += x[1]; n -= x[0]; } }); return o; }
var JOURS = ['lundi','mardi','mercredi','jeudi','vendredi','samedi','dimanche'];

/* ---------- CE1 ---------- */
function qCE1Polygone(R){
  var P = [['triangle',3],['quadrilatère',4],['pentagone',5],['hexagone',6]], a = R.pick(P), b = R.pick(P.filter(function(x){ return x[0]!==a[0]; })), c = R.pick(P);
  return { q:'Combien de côtés ont un '+a[0]+' et un '+b[0]+' ? Quel polygone a '+c[1]+' côtés ?', a:a[0]+' : '+a[1]+' côtés ; '+b[0]+' : '+b[1]+' côtés ; le polygone à '+c[1]+' côtés est le '+c[0]+'.' };
}
qCE1Polygone.kw = [/polygone/g,/cercle/g,/triangle/g,/rectangle/g,/carre/g,/figure/g,/ligne/g,/frontiere/g,/region/g];
function qCE1Solide(R){
  var S = [['cube',6],['pavé droit',6],['pyramide à base carrée',5],['prisme à base triangulaire',5]], a = R.pick(S), b = R.pick(S.filter(function(x){ return x[0]!==a[0]; }));
  return { q:'Combien de faces ont un(e) '+a[0]+' et un(e) '+b[0]+' ? Ces solides sont-ils des polyèdres ?', a:a[0]+' : '+a[1]+' faces ; '+b[0]+' : '+b[1]+' faces. Oui, ce sont des polyèdres (toutes leurs faces sont plates).' };
}
qCE1Solide.kw = [/polyedre/g,/pyramide/g,/solide/g,/cube/g,/pave/g,/face/g];
function qCE1Quadrillage(R){
  var col = R.int(1,3), lig = R.int(1,3), dx = R.int(1,3), dy = R.int(1,3), L = 'ABCDEFGH';
  return { q:'Sur un quadrillage, la bille est à la colonne '+L[col-1]+', ligne '+lig+'. Elle avance de '+dx+' case(s) vers la droite, puis de '+dy+' case(s) vers le haut. Où est-elle maintenant ?', a:'Colonne '+L[col-1+dx]+', ligne '+(lig+dy)+'.' };
}
qCE1Quadrillage.kw = [/quadrill/g,/reperage/g,/glissement/g,/rang/g,/colonne/g];
function qCE1Symetrie(R){
  var F = [['carré',4],['rectangle',2],['cercle','une infinité d’']], a = R.pick(F);
  return { q:'Combien d’axes de symétrie possède un '+a[0]+' ? Un axe de symétrie partage la figure en deux parties qui se superposent : vrai ou faux ?', a:a[0]+' : '+a[1]+' axe(s) de symétrie ; vrai.' };
}
qCE1Symetrie.kw = [/symetri/g,/axe/g,/figure/g];
function qCE1MasseCap(R){
  var v = distinct(R,3,2,40).map(function(x){ return x; }), u = R.pick(['kg','L']), nom = u==='kg' ? 'masses' : 'capacités';
  return { q:'Range les '+nom+' du plus petit au plus grand : '+v.map(function(x){ return x+' '+u; }).join(' ; ')+'.', a:v.slice().sort(asc).map(function(x){ return x+' '+u; }).join(' < ')+'.' };
}
qCE1MasseCap.kw = [/masse/g,/capacite/g,/comparaison/g,/dimension/g,/longueur/g];
function qCE1Calendrier(R){
  var j = R.int(0,6), k = R.int(2,5), m = R.pick([['juin',30],['mai',31],['avril',30],['juillet',31]]);
  return { q:'Combien y a-t-il de jours dans une semaine ? Si aujourd’hui est '+JOURS[j]+', quel jour serons-nous dans '+k+' jours ? Combien de jours compte le mois de '+m[0]+' ?', a:'Une semaine : 7 jours ; dans '+k+' jours : '+JOURS[(j+k)%7]+' ; '+m[0]+' : '+m[1]+' jours.' };
}
qCE1Calendrier.kw = [/calendrier/g,/duree/g,/semaine/g,/jour/g,/mois/g,/heure/g,/minute/g];
function qCE1Pair(R){
  var v = distinct(R,5,11,98), n = R.int(11,98), ar = Math.round(n/10)*10;
  return { q:'Entoure les nombres pairs : '+v.join(' ; ')+'. Arrondis '+n+' à la dizaine la plus proche.', a:'Nombres pairs : '+(v.filter(function(x){ return x%2===0; }).join(' ; ')||'aucun')+' ; '+n+' ≈ '+ar+'.' };
}
qCE1Pair.kw = [/pair/g,/impair/g,/arrond/g,/dizaine/g];
function qCE1Table(R){
  var a = R.int(3,9), b = R.int(3,9), c = R.pick([2,3,4,5]), d = R.int(3,9);
  return { q:'Complète : '+a+' × '+b+' = … ; '+c+' × … = '+(c*d)+' ; 7 × '+R.int(2,5)+' = … .', a:a+' × '+b+' = '+(a*b)+' ; '+c+' × '+d+' = '+(c*d)+' ; (7 × le nombre choisi).' };
}
qCE1Table.kw = [/table/g,/multiplication/g,/sens/g,/idee/g];
function qCE1Division(R){
  var k = R.pick([2,3,4,5]), q = R.int(3,9);
  return { q:'On partage '+(k*q)+' billes en parts égales entre '+k+' enfants. Combien de billes reçoit chaque enfant ?', a:(k*q)+' ÷ '+k+' = '+q+' billes.' };
}
qCE1Division.kw = [/division/g,/partage/g,/sens/g];
function qCE1Aire(R){
  var L = R.int(3,6), l = R.int(2,L);
  return { q:'Un rectangle est pavé avec '+L+' rangées de '+l+' carreaux. Combien de carreaux faut-il ? Que représente ce nombre ?', a:L+' × '+l+' = '+(L*l)+' carreaux ; c’est l’aire du rectangle.' };
}
qCE1Aire.kw = [/aire/g,/pavage/g,/carreau/g,/surface/g];
function qCE1Pourtour(R){
  var c = R.int(3,9), L = R.int(5,9), l = R.int(2,L-1);
  return { q:'Calcule le pourtour d’un carré de '+c+' cm de côté, puis celui d’un rectangle de '+L+' cm sur '+l+' cm.', a:'Carré : '+c+' × 4 = '+(4*c)+' cm ; rectangle : '+L+' + '+l+' + '+L+' + '+l+' = '+(2*(L+l))+' cm.' };
}
qCE1Pourtour.kw = [/pourtour/g,/perimetre/g,/longueur/g,/metre/g,/rectangle/g,/carre/g];

/* ---------- CM1 ---------- */
function qCM1Million(R){
  var a = R.int(2,9), b = R.int(1,9), c = R.int(1,9), n = a*1000000+b*100000+c*1000;
  return { q:'Écris en chiffres : '+a+' millions '+b+' centaines de mille '+c+' mille. Combien de milliers y a-t-il dans '+fr(n)+' ? Écris en chiffres 2 milliards.', a:fr(n)+' ; '+fr(n)+' = '+fr(n/1000)+' milliers ; 2 milliards = '+fr(2000000000)+'.' };
}
qCM1Million.kw = [/million/g,/milliard/g,/numeration/g,/999/g];
function qCM1Division(R){
  var k = R.int(12,48), q = R.int(21,96), r = R.int(1,k-1), N = k*q+r;
  return { q:'Pose et effectue la division de '+fr(N)+' par '+k+', puis vérifie ton résultat.', a:fr(N)+' ÷ '+k+' : quotient '+q+', reste '+r+' ; vérification : '+k+' × '+q+' + '+r+' = '+fr(N)+'.' };
}
qCM1Division.kw = [/division/g,/quotient/g,/diviseur/g,/reste/g,/lien/g];
function qCM1Moyenne(R){
  var a = R.int(8,18), b = R.int(8,18), c = R.int(8,18), s3 = a+b+c, d = 4*Math.ceil((s3+8)/4) - s3;   // 4 notes dont la somme est multiple de 4
  var tot = s3 + d;
  return { q:'Un élève obtient les notes suivantes : '+a+', '+b+', '+c+' et '+d+'. Calcule sa moyenne arithmétique.', a:'Somme : '+a+' + '+b+' + '+c+' + '+d+' = '+tot+' ; moyenne : '+tot+' ÷ 4 = '+(tot/4)+'.' };
}
qCM1Moyenne.kw = [/moyenne/g,/arithmetique/g,/modalite/g,/tableau/g,/donnee/g];
function qCM1Aire(R){
  var m = R.int(2,9), b = R.int(6,14), h = R.int(4,10)*2;
  return { q:'Convertis : '+m+' m² = … dm². Calcule l’aire d’un triangle rectangle dont les côtés de l’angle droit mesurent '+b+' cm et '+h+' cm.', a:m+' m² = '+fr(m*100)+' dm² ; aire = ('+b+' × '+h+') ÷ 2 = '+fr(b*h/2)+' cm².' };
}
qCM1Aire.kw = [/aire/g,/surface/g,/triangle/g,/multiples/g,/carre/g,/rectangle/g];
function qCM1Volume(R){
  var L = R.int(4,12), l = R.int(3,8), h = R.int(2,7), c = R.int(2,6);
  return { q:'Calcule le volume d’un pavé droit de '+L+' cm sur '+l+' cm sur '+h+' cm, puis celui d’un cube de '+c+' cm d’arête.', a:L+' × '+l+' × '+h+' = '+fr(L*l*h)+' cm³ ; cube : '+c+' × '+c+' × '+c+' = '+fr(c*c*c)+' cm³.' };
}
qCM1Volume.kw = [/volume/g,/pave/g,/cube/g,/metre cube/g,/solide/g,/capacite/g];
function qCM1Change(R){
  var e = R.int(2,9)*10, k = R.int(3,9)*100;
  return { q:'On donne : 1 euro = 655 F CFA. Un voyageur change '+e+' euros en F CFA. Combien reçoit-il ? Combien d’euros obtient-on avec '+fr(655*k/100)+' F CFA ?', a:e+' × 655 = '+fr(e*655)+' F CFA ; '+fr(655*k/100)+' ÷ 655 = '+(k/100)+' euros.' };
}
qCM1Change.kw = [/chang/g,/euro/g,/dollar/g,/monnaie/g];
function qCM1FractionOp(R){
  var d = R.pick([5,6,8,10,12]), a = R.int(1,d-2), b = R.int(1,d-a-1), e = R.int(2,6), n = R.int(2,5);
  return { q:'Calcule : '+a+'/'+d+' + '+b+'/'+d+' ; '+(a+b)+'/'+d+' − '+a+'/'+d+' ; '+n+' × '+e+'/'+d+'.', a:fq(a+b,d)+' ; '+fq(b,d)+' ; '+n+' × '+e+'/'+d+' = '+fq(n*e,d)+'.' };
}
qCM1FractionOp.kw = [/fraction/g,/somme/g,/difference/g,/denominateur/g,/prendre/g];
function qCM1Siecle(R){
  var Y = R.int(1701,1999), sc = Math.floor((Y-1)/100)+1;
  return { q:'Combien d’années y a-t-il dans une décennie, un siècle, un millénaire ? En quel siècle se situe l’année '+Y+' ?', a:'Décennie : 10 ans ; siècle : 100 ans ; millénaire : 1 000 ans ; '+Y+' appartient au '+roman(sc)+'e siècle ('+sc+'e siècle).' };
}
qCM1Siecle.kw = [/decennie/g,/siecle/g,/millenaire/g,/duree/g,/annee/g];

/* ---------- CM2 ---------- */
function qCM2Pourcent(R){
  var N = R.pick([20,40,50,80,100,200]), pct = R.pick([5,10,15,20,25,30,40,45,50,60,75]), E = N*pct/100;
  if(E!==Math.floor(E)){ N = 100; E = pct; }
  return { q:'Dans une école de '+N+' élèves, '+E+' sont inscrits à la cantine. Exprime la fréquence des élèves inscrits sous forme de pourcentage.', a:E+' ÷ '+N+' = '+fr(E/N)+' = '+pct+' %.' };
}
qCM2Pourcent.kw = [/pourcentage/g,/frequence/g,/taux/g,/pour cent/g];
function qCM2Proportion(R){
  var k = R.pick([250,300,400,500,750]), a = R.int(2,5), b = a+R.int(1,4), c = b+R.int(2,5);
  return { q:'Un tableau de proportionnalité donne : '+a+' kg coûtent '+fr(a*k)+' F. Complète : '+b+' kg coûtent … F ; '+c+' kg coûtent … F. Quel est le coefficient de proportionnalité ?', a:'Coefficient : '+fr(a*k)+' ÷ '+a+' = '+fr(k)+' ; '+b+' kg : '+b+' × '+fr(k)+' = '+fr(b*k)+' F ; '+c+' kg : '+fr(c*k)+' F.' };
}
qCM2Proportion.kw = [/proportionnalit/g,/coefficient/g,/debit/g,/taux/g,/graphique/g,/vitesse/g];
function qCM2Fractions(R){
  var d1 = R.pick([2,3,4,5]), m = R.pick([2,3,4]), d2 = d1*m, a = R.int(1,d1-1), b = R.int(1,d2-1);
  if(a*m===b) b = Math.max(1,b-1);
  return { q:'Réduis au même dénominateur puis compare '+a+'/'+d1+' et '+b+'/'+d2+'.', a:a+'/'+d1+' = '+(a*m)+'/'+d2+' ; '+(a*m)+'/'+d2+(a*m>b?' > ':' < ')+b+'/'+d2+' donc '+a+'/'+d1+(a*m>b?' > ':' < ')+b+'/'+d2+'.' };
}
qCM2Fractions.kw = [/fraction/g,/denominateur/g,/equivalente/g,/comparaison/g,/reduction/g,/somme/g];
function qCM2Disque(R){
  var r = R.int(3,15);
  return { q:'Un disque a un rayon de '+r+' cm (prends π = 3,14). Calcule son périmètre puis son aire.', a:'Périmètre : 2 × 3,14 × '+r+' = '+fr(rnd(2*3.14*r))+' cm ; aire : 3,14 × '+r+' × '+r+' = '+fr(rnd(3.14*r*r))+' cm².' };
}
qCM2Disque.kw = [/disque/g,/cercle/g,/circonference/g,/perimetre/g,/decomposable/g,/aire/g];
function qCM2Cylindre(R){
  var r = R.int(2,8), h = R.int(5,15);
  return { q:'Un cylindre droit a un rayon de '+r+' cm et une hauteur de '+h+' cm (π = 3,14). Calcule son aire latérale.', a:'Aire latérale : 2 × 3,14 × '+r+' × '+h+' = '+fr(rnd(2*3.14*r*h))+' cm².' };
}
qCM2Cylindre.kw = [/cylindre/g,/laterale/g,/aire totale/g,/solide/g];
function qCM2Agraires(R){
  var h = R.int(2,9), a = R.int(3,9), ha2 = R.int(2,6);
  return { q:'Convertis : '+h+' ha = … a ; '+a+' a = … ca ; '+ha2+' ha = … m².', a:h+' ha = '+fr(h*100)+' a ; '+a+' a = '+fr(a*100)+' ca ; '+ha2+' ha = '+fr(ha2*10000)+' m².' };
}
qCM2Agraires.kw = [/agraire/g,/hectare/g,/centiare/g,/are\b/g];
function qCM2Decimal(R){
  var a = R.int(21,79)/10, b = R.int(12,48)/10, N = R.pick([45,63,27,39]), k = R.pick([4,5,8]);
  return { q:'Calcule : '+fr(a)+' × '+fr(b)+' ; '+N+' ÷ '+k+' (donne le quotient décimal).', a:fr(a)+' × '+fr(b)+' = '+fr(rnd(a*b))+' ; '+N+' ÷ '+k+' = '+fr(rnd(N/k))+'.' };
}
qCM2Decimal.kw = [/decimal/g,/multiplication des nombres/g,/division des nombres/g,/dividende/g];
function qCM2Baton(R){
  var A = ['CE1','CE2','CM1','CM2'], v = [R.int(6,14),R.int(6,14),R.int(6,14)], tot3 = v[0]+v[1]+v[2], d = 4*Math.ceil((tot3+8)/4) - tot3; v.push(d);
  var tot = tot3 + d, mx = Math.max.apply(null,v);
  return { q:'Un diagramme en bâtons donne les effectifs de 4 classes : '+A.map(function(x,i){ return x+' : '+v[i]; }).join(' ; ')+'. Calcule l’effectif total, la moyenne par classe et nomme la classe la plus nombreuse.', a:'Total : '+tot+' élèves ; moyenne : '+tot+' ÷ 4 = '+(tot/4)+' ; la plus nombreuse : '+A[v.indexOf(mx)]+' ('+mx+' élèves).' };
}
qCM2Baton.kw = [/baton/g,/diagramme/g,/modalite/g,/frequence/g,/moyenne/g,/histogramme/g,/graphique/g];
function qCM2MasseSM(R){
  var g = R.int(2,9), kg = R.int(2,9)+R.pick([0,0.5]);
  return { q:'Convertis : '+g+' g = … dg = … cg = … mg ; '+fr(kg)+' kg = … g.', a:g+' g = '+(g*10)+' dg = '+(g*100)+' cg = '+fr(g*1000)+' mg ; '+fr(kg)+' kg = '+fr(rnd(kg*1000))+' g.' };
}
qCM2MasseSM.kw = [/masse/g,/gramme/g,/sous-multiples/g,/multiples/g];
function qCM2Symetrie(R){
  var F = [['carré',4],['rectangle',2],['cercle','une infinité d’'],['triangle équilatéral',3]], a = R.pick(F), b = R.pick(F.filter(function(x){ return x[0]!==a[0]; }));
  return { q:'Combien d’axes de symétrie possèdent un '+a[0]+' et un '+b[0]+' ? Comment reconnaît-on deux figures symétriques par rapport à une droite ?', a:a[0]+' : '+a[1]+' axe(s) ; '+b[0]+' : '+b[1]+' axe(s). Chaque point de l’une a son symétrique sur l’autre à égale distance de la droite, et le segment qui les joint est perpendiculaire à cette droite.' };
}
qCM2Symetrie.kw = [/symetri/g,/axe/g,/droite/g,/glissement/g,/point/g];
function qCM2Angle(R){
  var a = R.int(30,80), b = R.int(30,80);
  return { q:'Dans un triangle, deux angles mesurent '+a+'° et '+b+'°. Calcule la mesure du troisième angle, puis dis s’il est aigu, droit ou obtus.', a:'180 − ('+a+' + '+b+') = '+(180-a-b)+'° ; angle '+((180-a-b)<90?'aigu':((180-a-b)===90?'droit':'obtus'))+'.' };
}
qCM2Angle.kw = [/angle/g,/mesure d.angle/g,/triangle/g];

/* ---------- Lignes, régions, frontières, réseaux (CE1 → CM2) — avec schémas SVG ---------- */
function lbl(x,y,t,anchor){ return '<text x="'+x+'" y="'+y+'" text-anchor="'+(anchor||'middle')+'" fill="'+INK+'" stroke="#fff" stroke-width="3" paint-order="stroke" font-weight="bold">'+esc(t)+'</text>'; }
function pts(arr){ return arr.map(function(p){ return Math.round(p[0]*10)/10+','+Math.round(p[1]*10)/10; }).join(' '); }
function lineShape(k,cx,cy){
  var st = 'fill="none" stroke="'+INK+'" stroke-width="2.4" stroke-linejoin="round" stroke-linecap="round"';
  if(k==='tri') return '<polygon points="'+pts([[cx-36,cy+30],[cx+36,cy+30],[cx,cy-32]])+'" '+st+'/>';
  if(k==='rect') return '<rect x="'+(cx-40)+'" y="'+(cy-26)+'" width="80" height="52" '+st+'/>';
  if(k==='cercle') return '<circle cx="'+cx+'" cy="'+cy+'" r="30" '+st+'/>';
  if(k==='zigzag') return '<polyline points="'+pts([[cx-44,cy+26],[cx-22,cy-26],[cx,cy+26],[cx+22,cy-26],[cx+44,cy+26]])+'" '+st+'/>';
  if(k==='arc') return '<path d="M '+(cx-40)+' '+(cy+22)+' A 42 42 0 0 1 '+(cx+40)+' '+(cy+22)+'" '+st+'/>';
  if(k==='huit'){ var q = [], t; for(t=0;t<=6.35;t+=0.2) q.push([cx+42*Math.cos(t), cy+38*Math.sin(t)*Math.cos(t)]); return '<polyline points="'+pts(q)+'" '+st+'/>'; }
  if(k==='etoile'){ var o = [0,2,4,1,3,0].map(function(i){ var an = (-90+72*i)*Math.PI/180; return [cx+34*Math.cos(an), cy+34*Math.sin(an)]; }); return '<polyline points="'+pts(o)+'" '+st+'/>'; }
  return '';
}
function lignesSvg(ks){
  var out = '', xs = [60,180,300];
  ks.forEach(function(k,i){ out += lineShape(k,xs[i],52) + tx(xs[i],118,'('+'abc'[i]+')'); });
  return sv(360,128,out,360);
}
var LIG = { tri:['un triangle','brisée','fermée','simple'], rect:['un rectangle','brisée','fermée','simple'], cercle:['un cercle','courbe','fermée','simple'],
  zigzag:['un zigzag','brisée','ouverte','simple'], arc:['un arc de cercle','courbe','ouverte','simple'], huit:['un huit','courbe','fermée','non simple (elle se croise)'], etoile:['une étoile','brisée','fermée','non simple (elle se croise)'] };
function qCE2Lignes(R){
  var K = ['tri','rect','cercle','zigzag','arc','huit','etoile'], v = [], k;
  while(v.length<3){ k = R.pick(K); if(v.indexOf(k)<0) v.push(k); }
  return { figureHtml: lignesSvg(v), q:'Observe les lignes (a), (b) et (c). Pour chacune, dis si elle est brisée ou courbe, fermée ou ouverte, simple ou non.',
    a:v.map(function(x,i){ return '('+'abc'[i]+') '+LIG[x][1]+', '+LIG[x][2]+', '+LIG[x][3]; }).join(' ; ')+'.' };
}
qCE2Lignes.kw = [/ligne/g,/sorte/g,/simple/g,/fermee/g,/brisee/g,/courbe/g,/figure/g];
function qCE1LigneRegion(R){
  var C = ['tri','rect','cercle'], O = ['zigzag','arc'], c1 = R.pick(C), c2 = R.pick(C.filter(function(x){ return x!==c1; })), o = R.pick(O), v = [c1,c2,o], i, j, t;
  for(i=2;i>0;i--){ j = R.int(0,i); t = v[i]; v[i] = v[j]; v[j] = t; }
  var fer = []; v.forEach(function(x,i){ if(LIG[x][2]==='fermée') fer.push('('+'abc'[i]+')'); });
  return { figureHtml: lignesSvg(v), q:'Observe les lignes (a), (b) et (c). Lesquelles sont fermées ? Une ligne simple fermée peut servir de frontière : combien de régions détermine-t-elle ?',
    a:'Lignes fermées : '+fer.join(' et ')+'. Une frontière détermine 2 régions : la région intérieure et la région extérieure.' };
}
qCE1LigneRegion.kw = [/ligne/g,/frontiere/g,/region/g,/figure/g];
function regionsFig(v, R){
  var rc = '<rect x="20" y="14" width="320" height="110" fill="'+FILL+'" stroke="'+INK+'" stroke-width="2.4"/>', W = 'fill="#fff" stroke="'+INK+'" stroke-width="2.4" stroke-linejoin="round"', o = rc, i;
  function shape(k,cx,cy){
    if(k==='cercle') return '<circle cx="'+cx+'" cy="'+cy+'" r="28" '+W+'/>';
    if(k==='triangle') return '<polygon points="'+pts([[cx-30,cy+26],[cx+30,cy+26],[cx,cy-28]])+'" '+W+'/>';
    return '<rect x="'+(cx-26)+'" y="'+(cy-26)+'" width="52" height="52" '+W+'/>';
  }
  var N = { cercle:'le cercle (ligne courbe simple fermée)', triangle:'le triangle (ligne brisée simple fermée)', carre:'le carré (ligne brisée simple fermée)' };
  if(v==='cercles'){
    var n = R.int(2,4), cs = [];
    for(i=0;i<n;i++){ var cx = 20+320*(i+1)/(n+1); o += '<circle cx="'+cx+'" cy="69" r="'+(n>3?22:28)+'" '+W+'/>' + tx(cx,74,'BCD'[i]); cs.push(cx); }
    return { svg:sv(360,138,o+lbl(36,34,'A','start'),360), q:'Observe la figure. Combien de régions vois-tu ? Quelle ligne est la frontière de la région B ?', a:(n+1)+' régions (A, '+'BCD'.slice(0,n).split('').join(', ')+') ; la frontière de la région B est le cercle (ligne courbe simple fermée).' };
  }
  if(v==='formes'){
    var K = ['cercle','triangle','carre'], t, j, k = K.slice();
    for(i=2;i>0;i--){ j = R.int(0,i); t = k[i]; k[i] = k[j]; k[j] = t; }
    k.forEach(function(x,ix){ var cx = 100+80*ix; o += shape(x,cx,69) + tx(cx,76,'BCD'[ix]); });
    return { svg:sv(360,138,o+lbl(36,34,'A','start'),360), q:'Observe la figure. Combien de régions vois-tu ? Quelle ligne est la frontière de la région C ?', a:'4 régions (A, B, C, D) ; la frontière de la région C est '+N[k[1]]+'.' };
  }
  if(v==='emboites'){
    o += '<circle cx="180" cy="69" r="52" '+W+'/><polygon points="'+pts([[180,40],[150,94],[210,94]])+'" '+W+'/>' + tx(140,56,'B') + tx(180,82,'C') + lbl(36,34,'A','start');
    return { svg:sv(360,138,o,360), q:'Observe la figure. Combien de régions vois-tu ? Les régions A et C sont-elles voisines ? Pourquoi ?', a:'3 régions (A, B, C). Non, A et C ne sont pas voisines : la région B les sépare ; A touche B par le cercle et C touche B par le triangle, mais A et C n’ont aucune frontière commune.' };
  }
  if(v==='chevauche'){
    o += '<circle cx="150" cy="69" r="48" '+W+'/><circle cx="210" cy="69" r="48" fill="none" stroke="'+INK+'" stroke-width="2.4"/>' + tx(118,74,'B') + tx(180,74,'C') + tx(242,74,'D') + lbl(36,34,'A','start');
    return { svg:sv(360,138,o,360), q:'Observe la figure : deux cercles se chevauchent dans un rectangle. Combien de régions vois-tu ? Quelles régions sont voisines de la région C ?', a:'4 régions (A, B, C, D). Voisines de C : B et D ; A n’est pas voisine de C.' };
  }
  var diag = R.pick([0,1]);
  o += diag ? '<line x1="140" y1="14" x2="220" y2="124" stroke="'+INK+'" stroke-width="2.4"/>' + tx(80,74,'A') + tx(290,74,'B') : '<line x1="180" y1="14" x2="180" y2="124" stroke="'+INK+'" stroke-width="2.4"/>' + tx(100,74,'A') + tx(260,74,'B');
  return { svg:sv(360,138,o,360), q:'Observe la figure : une ligne traverse le rectangle de part en part. Combien de régions obtient-on ? Les régions A et B sont-elles voisines ? Pourquoi ?', a:'2 régions (A et B). Oui, elles sont voisines : elles ont en commun une partie de leur frontière (la ligne qui traverse le rectangle).' };
}
function qCE2Region(R){
  var f = regionsFig(R.pick(['cercles','formes','emboites','chevauche','coupe']), R);
  return { figureHtml: f.svg, q:f.q, a:f.a };
}
qCE2Region.kw = [/region/g,/frontiere/g];
function voisinesSvg(L){
  var out = '<rect x="80" y="12" width="200" height="110" fill="'+FILL+'" stroke="'+INK+'" stroke-width="2.4"/><line x1="180" y1="12" x2="180" y2="122" stroke="'+INK+'" stroke-width="2.4"/><line x1="80" y1="67" x2="280" y2="67" stroke="'+INK+'" stroke-width="2.4"/>';
  out += tx(130,46,L[0])+tx(230,46,L[1])+tx(130,101,L[2])+tx(230,101,L[3]);
  return sv(360,134,out,360);
}
function qCE2Voisines(R){
  var A = 'ABCDEFGH', b = R.int(0,4), L = [A[b],A[b+1],A[b+2],A[b+3]], k = R.int(0,3);
  return { figureHtml: voisinesSvg(L), q:'Observe la figure. Quelles régions sont voisines de la région '+L[k]+' ? Les régions '+L[k]+' et '+L[3-k]+' sont-elles voisines ? Pourquoi ?',
    a:'Voisines de '+L[k]+' : '+L[k^1]+' et '+L[k^2]+' ; '+L[k]+' et '+L[3-k]+' ne sont pas voisines : elles se touchent seulement en un point, leurs frontières n’ont aucune partie en commun.' };
}
qCE2Voisines.kw = [/voisin/g];
/* L'élève trace lui-même la ligne / la figure dans un cadre pointillé ; le corrigé donne un exemple et les critères. */
var TRACES = {
  lbo:   ['Trace une ligne brisée, simple et fermée.','Exemple : un triangle, un rectangle ou un pentagone. Critères : uniquement des segments droits ; la ligne ne se croise pas ; son point de départ est aussi son point d’arrivée.','ligne'],
  lbs:   ['Trace une ligne brisée, simple et ouverte.','Exemple : un zigzag. Critères : uniquement des segments droits ; la ligne ne passe jamais deux fois au même endroit ; ses deux extrémités ne se touchent pas.','ligne'],
  lcf:   ['Trace une ligne courbe, simple et fermée.','Exemple : un cercle ou un ovale. Critères : aucun segment droit ; la ligne ne se croise pas ; elle se referme sur son point de départ.','ligne'],
  lco:   ['Trace une ligne courbe, simple et ouverte.','Exemple : un arc de cercle ou une vague. Critères : aucun segment droit ; la ligne ne se croise pas ; ses deux extrémités ne se touchent pas.','ligne'],
  lbn:   ['Trace une ligne brisée qui n’est pas simple.','Exemple : une étoile tracée d’un seul trait ou un zigzag qui se recoupe. Critère : la ligne passe au moins deux fois au même endroit (elle se croise).','ligne'],
  lcn:   ['Trace une ligne courbe fermée qui n’est pas simple.','Exemple : un huit. Critères : ligne courbe ; elle se referme ; elle se croise en un point.','ligne'],
  front: ['Trace une frontière, puis colorie la région intérieure.','Une ligne simple fermée (cercle, carré, triangle…). Elle détermine deux régions : la région intérieure, coloriée, et la région extérieure.','region'],
  voisi: ['Dessine deux régions voisines et colorie-les de deux couleurs différentes.','Exemple : deux rectangles accolés. Critère : leurs frontières ont une partie en commun (un côté commun).','voisin'],
  reseau:['Dessine un réseau de 5 points qui possède au moins un point terminal, un point de relais et un point d’intersection. Nomme ces points.','Exemple : A relié à B, B relié à C, C relié à D et à E. A est un point terminal (1 direction), B un point de relais (2 directions), C un point d’intersection (3 directions).','reseau']
};
function traceChoix(R, tn, keys){
  var tot = 0, w = keys.map(function(k){ var t = TRACES[k][2], x = 1; if(t==='reseau' && /reseau/.test(tn)) x += 4; if(t==='region' && /region|frontiere/.test(tn)) x += 3; if(t==='voisin' && /voisin|region/.test(tn)) x += 2; if(t==='ligne' && /ligne/.test(tn)) x += 2; tot += x; return x; });
  var r = R.n()*tot, i = 0; while(i<keys.length-1 && r>=w[i]){ r -= w[i]; i++; }
  return TRACES[keys[i]];
}
function qCE2Tracer(R, tn){
  var t = traceChoix(R, tn||'', ['lbo','lbs','lcf','lco','lbn','lcn','front','voisi','reseau']);
  return { q:t[0]+' [[cadre]]', a:t[1] };
}
qCE2Tracer.kw = [/construction/g,/trace/g];
function qCE1Tracer(R, tn){
  var t = traceChoix(R, tn||'', ['lbo','lbs','lcf','lco','front']);
  return { q:t[0]+' [[cadre]]', a:t[1] };
}
qCE1Tracer.kw = [/ligne/g,/frontiere/g,/region/g,/trace/g];
function netSvg(P, E, labels){
  var out = '';
  E.forEach(function(e){ out += '<line x1="'+P[e[0]][0]+'" y1="'+P[e[0]][1]+'" x2="'+P[e[1]][0]+'" y2="'+P[e[1]][1]+'" stroke="'+INK+'" stroke-width="2.4"/>'; });
  P.forEach(function(p,i){
    var vx = 0, vy = 0, n, d;   // l'étiquette se place à l'opposé des branches qui partent du point
    E.forEach(function(e){ if(e[0]===i||e[1]===i){ n = P[e[0]===i?e[1]:e[0]]; d = Math.sqrt((n[0]-p[0])*(n[0]-p[0])+(n[1]-p[1])*(n[1]-p[1]))||1; vx += (n[0]-p[0])/d; vy += (n[1]-p[1])/d; } });
    var m = Math.sqrt(vx*vx+vy*vy), lx = p[0], ly = p[1]-13;
    if(m>0.3){ lx = p[0]-vx/m*15; ly = p[1]-vy/m*15; }
    ly = Math.min(Math.max(ly+5,14),132);
    out += '<circle cx="'+p[0]+'" cy="'+p[1]+'" r="5.5" fill="'+INK+'"/>' + lbl(Math.min(Math.max(lx,10),350), ly, labels[i]);
  });
  return sv(360,150,out+tx(180,146,'Réseau'),360);
}
var NETS = [
  { P:[[40,112],[115,112],[195,68],[115,28],[200,22],[270,100],[330,118]], E:[[0,1],[1,2],[1,3],[2,4],[2,5],[5,6]] },
  { P:[[40,76],[120,38],[120,114],[200,76],[280,38],[280,114]], E:[[0,1],[0,2],[1,3],[2,3],[3,4],[3,5]] }
];
function qCE2Reseau(R){
  var T = R.pick(NETS), A = 'ABCDEFGH', b = R.int(0,1), labels = T.P.map(function(p,i){ return A[b+i]; }), deg = T.P.map(function(){ return 0; });
  T.E.forEach(function(e){ deg[e[0]]++; deg[e[1]]++; });
  function liste(f){ return labels.filter(function(l,i){ return f(deg[i]); }).join(', ') || 'aucun'; }
  return { figureHtml: netSvg(T.P, T.E, labels), q:'Observe le réseau. Nomme les points terminaux, les points de relais et les points d’intersection.',
    a:'Points terminaux (une seule direction) : '+liste(function(d){ return d===1; })+' ; points de relais (deux directions) : '+liste(function(d){ return d===2; })+' ; points d’intersection (plus de deux directions) : '+liste(function(d){ return d>2; })+'.' };
}
qCE2Reseau.kw = [/reseau/g,/reseau/g,/reseau/g,/terminal/g,/relais/g,/intersection/g,/noeud/g,/chemin/g];
function qCMReseau(R){
  var L = 'ABCDE', P = [[40,108],[115,38],[195,108],[270,38],[330,108]], conn = R.pick([0,1]), E = [], cut = R.int(2,3), i;
  if(conn){ for(i=0;i<4;i++) E.push([i,i+1]); if(R.pick([0,1])) E.push([0,R.int(2,4)]); }
  else { for(i=0;i<cut-1;i++) E.push([i,i+1]); for(i=cut;i<4;i++) E.push([i,i+1]); }
  var adj = [[],[],[],[],[]]; E.forEach(function(e){ adj[e[0]].push(e[1]); adj[e[1]].push(e[0]); });
  function path(x,y){ var par = {}, qu = [x], seen = {}; seen[x] = 1; while(qu.length){ var c = qu.shift(); if(c===y){ var r = [y]; while(r[0]!==x) r.unshift(par[r[0]]); return r; } adj[c].forEach(function(z){ if(!seen[z]){ seen[z] = 1; par[z] = c; qu.push(z); } }); } return null; }
  var pa = path(0,4), a = pa ? 'Oui, ce réseau est connexe : on peut aller de n’importe quel nœud à un autre, par exemple de A à E par '+pa.map(function(x){ return L[x]; }).join(' – ')+'.'
    : 'Non, ce réseau n’est pas connexe : il n’existe aucun chemin pour aller, par exemple, de A à E.';
  return { figureHtml: netSvg(P, E, L.split('')), q:'Observe le réseau de nœuds A, B, C, D et E. Ce réseau est-il connexe ? Justifie ta réponse.', a:a };
}
qCMReseau.kw = [/reseau/g,/connexe/g,/noeud/g,/chemin/g,/branche/g];

var PROBS = {
  CE1: [qProbCE1Achat, qProbCE1Paniers],
  CE2: [qProbCE2Achat, qProbCE2Bidons, qProbCE2Trajet],
  CM1: [qProbCM1Champ, qProbCM1Fraction, qProbCM1Prix],
  CM2: [qProbCM2Reduc, qProbCM2Vitesse, qProbCM2Citerne]
};

/* ------------------------------------------------------------------ */
/* Composition d'une épreuve de mathématiques selon la classe          */
/* ------------------------------------------------------------------ */
var POOLS = {
  CI:  { A:[gCompterCI], B:[gProblemeCI], Q:[qCIEcrire,qCIRanger,qCISuite,qCIPlace,qCIExtremes] },
  CP:  { A:[gNombresCP], B:[gOpsCP], Q:[qCPMonnaie,qCPFigures,qCPSuite,qCPDouble,qCPLettres] },
  CE1: { A:[gNombresCE1], B:[gOpsCE1], Q:[qCE1Mesure,qCE1Heure,qCE1Double,qCE1Monnaie,qCE1Figures,qCE1Polygone,qCE1Solide,qCE1Quadrillage,qCE1Symetrie,qCE1MasseCap,qCE1Calendrier,qCE1Pair,qCE1Table,qCE1Division,qCE1Aire,qCE1Pourtour,qCE1LigneRegion,qCE1Tracer] },
  CE2: { A:[gNombresCE2], B:[gOpsCE2,gAchatsCE2], Q:[qCE2Mesures,qDuree,qCE2Perim,qCE2Fraction,qCE2Partage,qCE2Angles,qCE2Solides,qCE2Monnaie,qCE2Epargne,qCE2Aire,qCE2Tableau,qCE2Plan,qCE2Symetrie,qCE2Masse,qCE2Lignes,qCE2Region,qCE2Voisines,qCE2Reseau,qCE2Tracer] },
  CM1: { A:[gStats,gProp], B:[gAires,gPerimCM1], Q:[qOperationsCM1,qConversion,qDuree,qFractionDe,qDecimaux,qEncadrer,qCM1Million,qCM1Division,qCM1Moyenne,qCM1Aire,qCM1Volume,qCM1Change,qCM1FractionOp,qCM1Siecle,qCMReseau] },
  CM2: { A:[gStats,gProp], B:[gAires,gPerim], Q:[qVolume,qDecimaux,qEncadrer,qFractionDe,qConversion,qDuree,qOperations,qCM2Pourcent,qCM2Proportion,qCM2Fractions,qCM2Disque,qCM2Cylindre,qCM2Agraires,qCM2Decimal,qCM2Baton,qCM2MasseSM,qCM2Symetrie,qCM2Angle,qCMReseau] }
};
var CONSIGNE_PETITS = { CI:1, CP:1, CE1:1 };

function mathsDoc(text, seed, classe, lv){
  var R = mkR(seed), tn = norm(text);
  R.lv = Math.min(3,Math.max((classe==='CI' || classe==='CP') ? 1 : ((classe==='CE1') ? 2 : 3), lv||2)); R.cls = classe;   // à partir du CE1, jamais en dessous du niveau intermédiaire
  var P = POOLS[classe] || POOLS.CM2;
  var i1g = best(P.A, tn, R), i2g = best(P.B, tn, R), i1 = i1g(R, tn), i2 = i2g(R, tn);
  var ranked = P.Q.map(function(g){ return { g:g, s:score(g,tn,R) }; }).sort(function(a,b){ return b.s-a.s; }).slice(0,3).map(function(x){ return x.g; });
  recentGens = [i1g, i2g].concat(ranked);
  ranked.sort(function(a,b){ return (b.first?1:0) - (a.first?1:0); });   // le volume (qui a une introduction) passe en premier
  var parts = ranked.map(function(g){ return g(R, tn); });
  if(PROBS[classe]){ var pg = best(PROBS[classe], tn, R); recentGens.push(pg); parts.push(pg(R, tn)); }   // + une situation-problème à plusieurs étapes
  var i3 = {
    intro: parts.map(function(p){ return p.intro; }).filter(Boolean).join(' '),
    figureHtml: parts.map(function(p){ return p.figureHtml; }).filter(Boolean).join(''),
    questions: parts.map(function(p){ return p.q; }),
    corrige: parts.map(function(p){ return p.a; })
  };
  var ev = R.pick(EVENTS);
  var ctxs = [i1.ctx, i2.ctx].concat(parts.map(function(p){ return p.ctx; })).filter(Boolean);
  var support = 'Pour préparer '+ev+', une école mobilise les élèves de '+classe+' autour de plusieurs activités. '+ctxs.join(' ');
  return {
    type: 'maths',
    support: { titre: '', texte: support },
    tache: CONSIGNE_PETITS[classe]
      ? 'Lis bien chaque item, puis réponds aux questions pour aider l’école à bien préparer '+ev+'.'
      : 'À partir des informations du support et des données de chaque item, effectue les calculs nécessaires pour aider l’école à bien organiser '+ev+'.',
    items: [i1, i2, i3],
    corrige: [i1, i2, i3].map(function(it,k){ return { item:'Item '+(k+1), lignes: it.corrige }; })
  };
}

/* ------------------------------------------------------------------ */
/* Mise en page                                                        */
/* ------------------------------------------------------------------ */
var CSS = ''
+ '.ep-page{width:'+PAGE_W+'px;height:'+PAGE_H+'px;box-sizing:border-box;padding:'+PAD_TOP+'px '+PAD_X+'px '+PAD_BOT+'px;background:#fff;color:#111;font-family:Arial,Helvetica,sans-serif;font-size:13.5px;line-height:1.33;position:relative;overflow:hidden}'
+ '.ep-page *{box-sizing:border-box}'
+ '.ep-in{width:100%}'
+ '.ep-head{border-bottom:2.5px solid #0A6FD8;padding-bottom:6px;margin-bottom:7px}'
+ '.ep-h1{display:flex;justify-content:space-between;gap:10px;font-size:11.5px;font-weight:bold;color:#0b1f3f;text-transform:uppercase}'
+ '.ep-h2{text-align:center;font-size:12.5px;font-weight:bold;color:#0b1f3f;margin:3px 0 5px;text-transform:uppercase}'
+ '.ep-h3{text-align:center;font-size:17px;font-weight:bold;color:#0A6FD8;letter-spacing:.2px}'
+ '.ep-h4{text-align:center;font-size:15px;font-weight:bold;color:#0b1f3f;margin-top:1px}'
+ '.ep-h5{text-align:center;font-size:12.5px;font-weight:bold;margin-top:2px}'
+ '.ep-nom{margin-top:6px;font-size:12px;display:flex;justify-content:space-between}'
+ '.ep-box{border:1.5px solid #0A6FD8;border-radius:6px;padding:6px 11px;margin:6px 0;background:#f6faff}'
+ '.ep-lab{font-weight:bold;color:#0A6FD8;margin-bottom:3px}'
+ '.ep-txt p{margin:0 0 4px;text-align:justify}'
+ '.ep-tache{margin:6px 0;font-size:13.5px}'
+ '.ep-item{margin:7px 0;page-break-inside:avoid}'
+ '.ep-itemt{font-weight:bold;color:#fff;background:#0A6FD8;display:inline-block;padding:0 10px;border-radius:4px;margin-bottom:3px;font-size:12.5px}'
+ '.ep-intro{margin:2px 0 4px}'
+ '.ep-q{margin:2px 0 2px 4px}'
+ '.ep-q b{color:#0A6FD8}'
+ '.ep-cut{border-top:1.5px dashed #777;margin:12px 0;text-align:center;font-size:11px;color:#555;height:0;overflow:visible;position:relative}'
+ '.ep-cut span{position:relative;top:-8px;background:#fff;padding:0 8px}'
+ '.ep-foot{position:absolute;left:'+PAD_X+'px;right:'+PAD_X+'px;bottom:10px;height:'+FOOT_H+'px;border-top:1px solid #cfd8e8;font-size:10px;color:#667;display:flex;justify-content:space-between;padding-top:4px}'
+ '.ep-co table{width:100%;border-collapse:collapse;font-size:12.5px;margin:2px 0 6px}'
+ '.ep-co th{background:#e3f0ff;color:#0b1f3f;border:1px solid #9fb6d8;padding:3px 6px;text-align:left}'
+ '.ep-co td{border:1px solid #9fb6d8;padding:3px 6px;vertical-align:top}'
+ '.ep-measure{position:absolute;left:-9999px;top:0;visibility:hidden;width:'+(PAGE_W-2*PAD_X)+'px;font-family:Arial,Helvetica,sans-serif;font-size:13.5px;line-height:1.33;color:#111}'
+ '.ep-measure *{box-sizing:border-box}'
+ '.ep-cfg .ep-lbl{font-size:12px;font-weight:700;color:var(--ink-soft);margin:12px 0 4px;display:block}'
+ '.ep-cfg input[type=text],.ep-cfg textarea{width:100%;padding:10px 12px;border:1.5px solid var(--line);border-radius:10px;font:inherit;font-size:14px;background:#fff;color:var(--ink)}'
+ '.ep-cfg textarea{min-height:64px;resize:vertical}'
+ '.ep-row{display:flex;align-items:center;gap:10px;padding:10px 12px;border:1.5px solid var(--line);border-radius:12px;margin-bottom:7px;background:#fff;cursor:pointer}'
+ '.ep-row.on{border-color:var(--blue);background:#EAF4FF}'
+ '.ep-row .ck{flex:none;width:22px;height:22px;border-radius:7px;border:2px solid #b8c6dc;display:flex;align-items:center;justify-content:center;color:#fff;font-size:14px;font-weight:800}'
+ '.ep-row.on .ck{background:var(--blue);border-color:var(--blue)}'
+ '.ep-row .tt{flex:1;min-width:0;font-size:13.5px;font-weight:600;color:var(--ink)}'
+ '.ep-row .tt small{display:block;font-weight:500;color:var(--ink-soft);font-size:11.5px}'
+ '.ep-row .upto{flex:none;border:none;background:#fff;border:1.5px solid var(--line);border-radius:8px;padding:5px 8px;font-size:11px;font-weight:700;color:var(--blue);cursor:pointer}'
+ '.ep-sel{width:100%;padding:10px 12px;border:1.5px solid var(--line);border-radius:10px;font:inherit;font-size:14px;background:#fff;color:var(--ink)}'
+ '.ep-chips{display:flex;gap:7px;flex-wrap:wrap;margin:4px 0 14px}'
+ '.ep-chip{padding:7px 14px;border-radius:999px;border:1.5px solid var(--line);background:#fff;font-weight:700;font-size:13px;color:var(--ink);cursor:pointer}'
+ '.ep-chip.on{background:var(--blue);border-color:var(--blue);color:#fff}'
+ '.ep-chip.off{opacity:.45;cursor:not-allowed}'
+ '.ep-btn{display:block;width:100%;margin:10px 0 0;padding:13px 16px;border:none;border-radius:14px;font-weight:800;font-size:14.5px;cursor:pointer;background:var(--blue);color:#fff}'
+ '.ep-btn.alt{background:#fff;color:var(--blue);border:2px solid var(--blue)}'
+ '.ep-btn:disabled{opacity:.5;cursor:not-allowed}'
+ '.ep-pv{width:100%;position:relative;overflow:hidden;border:1px solid var(--line);border-radius:10px;margin:0 0 12px;background:#fff;box-shadow:0 3px 12px rgba(11,42,82,.10)}'
+ '.ep-pv .ep-page{transform-origin:0 0;position:absolute;left:0;top:0}'
+ '.ep-sum{display:flex;align-items:center;gap:10px;padding:10px 12px;border:1.5px solid var(--blue);border-radius:12px;background:#EAF4FF;margin:4px 0 8px}'
+ '.ep-sum span{flex:1;min-width:0;font-size:13.5px;font-weight:700;color:var(--ink)}'
+ '.ep-sum small{display:block;font-weight:500;color:var(--ink-soft);font-size:11.5px;margin-top:2px}'
+ '.ep-sum button{flex:none;border:1.5px solid var(--blue);background:#fff;color:var(--blue);border-radius:8px;padding:6px 12px;font-weight:700;font-size:12px;cursor:pointer}'
+ '.ep-note{font-size:12px;color:var(--ink-soft);margin:6px 0}'
+ '.ep-err{background:#FFF1F0;border:1.5px solid #f3b7b1;color:#a12a20;border-radius:12px;padding:10px 12px;font-size:13px;margin:10px 0}'
+ '.ep-wait{text-align:center;padding:50px 16px;color:var(--ink-soft);font-size:14px}'
+ '.ep-spin{width:34px;height:34px;border:4px solid #d6e6fb;border-top-color:var(--blue);border-radius:50%;margin:0 auto 14px;animation:epspin 1s linear infinite}'
+ '@keyframes epspin{to{transform:rotate(360deg)}}';

function ensureStyle(){
  if(document.getElementById('ep-style')) return;
  var st = document.createElement('style'); st.id = 'ep-style'; st.textContent = CSS; document.head.appendChild(st);
}

function para(s){ return esc(s).replace(/\n/g,'<br>'); }
function stripLetter(q){ return String(q||'').replace(/^\s*[A-Da-d][.)]\s+/,''); }
function qHtml(q, i){
  var L = String.fromCharCode(65+i);
  var cadre = /\[\[cadre\]\]/.test(String(q));   // question de tracé : un cadre pointillé sert de zone de dessin
  var lines = String(q).replace(/\s*\[\[cadre\]\]/g,'').split('\n');
  var html = '<b>'+L+'.</b> '+esc(stripLetter(lines[0]));
  for(var k=1;k<lines.length;k++) html += '<br>'+esc(lines[k]);
  return '<div class="ep-q">'+html+(cadre ? '<div style="border:1.5px dashed #6b7c93;border-radius:4px;height:112px;margin:5px 0 3px"></div>' : '')+'</div>';
}

function entete(doc, ent, kind){
  var tp = T(doc.type);
  var dots = '.....................................';
  var mo = String(ent.mois||'').toUpperCase();
  var evalTitle = 'ÉVALUATION DU MOIS ' + (/^[AEIOUÉÈ]/.test(mo) ? 'D\u2019' : 'DE ') + (mo || dots);
  var title = kind==='co' ? 'CORRIGÉ TYPE' : evalTitle;
  var sub = kind==='co' ? '<div class="ep-h5">'+esc(evalTitle)+'</div>' : '';
  return '<div class="ep-head">'
    + '<div class="ep-h1"><span>Circonscription scolaire de '+esc(ent.circ||dots)+'</span><span>Année scolaire '+esc(ent.annee||dots)+'</span></div>'
    + '<div class="ep-h2">École : '+esc(ent.ecole||dots)+'</div>'
    + '<div class="ep-h3">'+title+'</div>'
    + '<div class="ep-h4">'+esc(tp.titre)+' — '+esc(S.classe)+'</div>'
    + '<div class="ep-h5">Durée : '+esc(dureeOf(tp))+'</div>'
    + sub
    + (kind==='co' ? '' : '<div class="ep-nom"><span>Nom et prénoms : ............................................................</span></div>')
    + '</div>';
}

function blocksEpreuve(doc){
  var out = [];
  var sup = doc.support || {};
  var isDessin = doc.type==='dessin';
  var paras = String(sup.texte||'').split(/\n+/).filter(Boolean);
  var lab = isDessin ? 'Situation' : 'Support' + (sup.titre ? ' : '+esc(sup.titre) : '');
  out.push('<div class="ep-box"><div class="ep-lab">'+lab+'</div><div class="ep-txt">'+paras.map(function(p){ return '<p>'+esc(p)+'</p>'; }).join('')+'</div></div>');
  out.push('<div class="ep-tache"><b>Tâche :</b> '+esc(String(doc.tache||'').replace(/^T[âa]che\s*:\s*/i,''))+'</div>');
  if(isDessin){
    var cons = (doc.consigne||[]).slice(), last = '';
    if(cons.length && /^respecte/i.test(cons[cons.length-1])) last = cons.pop();
    out.push('<div class="ep-item"><div class="ep-itemt">Consigne</div><div class="ep-intro">Sur une feuille, représente :</div>'
      + '<ul style="margin:3px 0 6px 22px;padding:0">'+cons.map(function(c){ return '<li>'+esc(c.replace(/^[\u2022\-\s]+/,''))+'</li>'; }).join('')+'</ul>'
      + (last ? '<div>'+esc(last)+'</div>' : '')+'</div>');
    return out;
  }
  (doc.items||[]).forEach(function(it,k){
    out.push('<div class="ep-item"><div class="ep-itemt">Item '+(k+1)+'</div>'
      + (it.intro ? '<div class="ep-intro">'+para(it.intro)+'</div>' : '')
      + (it.tableHtml ? it.tableHtml : '')
      + (it.figureHtml ? '<div style="margin:2px 0 0">'+it.figureHtml+'</div>' : '')
      + (it.figure ? '<div style="margin:6px 0 2px">'+circuitSvg(it.figure)+'</div>' : '')
      + it.questions.map(qHtml).join('') + '</div>');
  });
  return out;
}

/* Barème sur 20 (conservé pour les essais hors navigateur, plus affiché) : une note par ligne du corrigé. */
function bareme(corrige){
  var n = 0; corrige.forEach(function(c){ n += c.lignes.length; });
  if(!n) return corrige.map(function(c){ return c.lignes.map(function(){ return 0; }); });
  var base = Math.floor(20/n*2)/2, rest = rnd(20 - base*n);
  var flat = []; for(var i=0;i<n;i++) flat.push(base);
  for(var j=0; rest>0.0001 && j<4*n; j++){ var idx = j % n; var add = Math.min(0.5, rest); flat[idx] = rnd(flat[idx]+add); rest = rnd(rest-add); }
  var k = 0;
  return corrige.map(function(c){ return c.lignes.map(function(){ return flat[k++]; }); });
}
/* Corrigé type : les réponses attendues seulement (pas de barème). */
function blocksCorrige(doc){
  var out = [];
  (doc.corrige||[]).forEach(function(c,i){
    out.push('<div class="ep-co ep-item"><div class="ep-itemt">'+esc(c.item||('Item '+(i+1)))+'</div><table><tr><th style="width:42px">N°</th><th>Réponse attendue</th></tr>'
      + c.lignes.map(function(l,k){ return '<tr><td>'+String.fromCharCode(65+k)+'</td><td>'+esc(stripLetter(l))+'</td></tr>'; }).join('')
      + '</table></div>');
  });
  return out;
}

function measure(html){
  var m = document.createElement('div'); m.className = 'ep-measure'; m.innerHTML = html;
  document.body.appendChild(m);
  var h = m.offsetHeight; m.parentNode.removeChild(m);
  return h;
}
function pageWrap(inner, i, n, label){
  return '<div class="ep-page"><div class="ep-in">'+inner+'</div><div class="ep-foot"><span>FicheProBot — '+esc(label)+'</span><span>Page '+(i+1)+'/'+n+'</span></div></div>';
}

/* Répartit l'en-tête et les blocs sur des feuilles A4 ; épreuves courtes en deux exemplaires par feuille. */
function paginate(doc, ent, kind){
  var tp = T(doc.type);
  var blocks = kind==='co' ? blocksCorrige(doc) : blocksEpreuve(doc);
  var head = entete(doc, ent, kind);
  var label = (kind==='co' ? 'Corrigé — ' : 'Épreuve — ') + tp.label + ' ' + S.classe;
  var cap = PAGE_H - PAD_TOP - PAD_BOT - FOOT_H - 8;
  if(kind!=='co' && tp.dbl){
    var copy = head + blocks.join('');
    var h = measure(copy);
    if(h*2 + 40 <= cap){
      var cut = '<div class="ep-cut"><span>- - - découper ici - - -</span></div>';
      return [ pageWrap(copy + cut + copy, 0, 1, label) ];
    }
  }
  var pages = [], cur = head, used = measure(head);
  var headCompact = '<div class="ep-head" style="padding-bottom:4px"><div class="ep-h4" style="font-size:13px">'+esc(tp.titre)+' — '+esc(S.classe)+' (suite)</div></div>';
  blocks.forEach(function(b){
    var bh = measure(b);
    if(used + bh > cap && cur !== '' && cur !== head && cur !== headCompact){
      pages.push(cur); cur = headCompact; used = measure(headCompact);
    }
    cur += b; used += bh;
  });
  pages.push(cur);
  return pages.map(function(p,i){ return pageWrap(p, i, pages.length, label); });
}

/* ------------------------------------------------------------------ */
/* Données : groupes de SA, sélection                                  */
/* ------------------------------------------------------------------ */
function addPart(parts, prefix, v){
  v = String(v||'').trim(); if(!v) return;
  if(/^\d+$/.test(v)) v = prefix+' '+v;
  parts.push(v);
}
/* SA du programme officiel (guide de concrétisation) : elles sont proposées même sans résumé enregistré. */
function sigOf(d, s){
  var n = function(v){ var m = String(v==null?'':v).match(/\d+/); return m ? String(parseInt(m[0],10)) : ''; };
  return n(d) + '|' + n(s);
}
function progEntries(){
  if(S.type!=='maths' || typeof window==='undefined' || !Array.isArray(window.MATHS_CONCRETISATION)) return [];
  return window.MATHS_CONCRETISATION.filter(function(e){ return e && e.classe===S.classe; });
}
function keyNums(g){
  var k = String(g.key), u = /Unit[ée]\s*(\d+)/i.exec(k), d = /Dossier\s*(\d+)/i.exec(k), s = /SA\s*(\d+)/i.exec(k);
  return [u?+u[1]:0, d?+d[1]:999, s?+s[1]:0];
}
function groups(){
  var gs = groupsRaw();
  var prog = progEntries();
  if(!prog.length) return gs;
  var have = {};
  gs.forEach(function(g){ var r = g.items[0] || {}; g.sig = sigOf(r.dossier, r.sa); have[g.sig] = g; });
  prog.forEach(function(e){
    var sg = sigOf(e.dossier, e.sa), g = have[sg];
    if(!g){
      var p = []; addPart(p,'Dossier',e.dossier); if(!/unique/i.test(String(e.sa||''))) addPart(p,'SA',e.sa);
      g = { key: p.join(' · ') || 'Programme', items: [], sig: sg, synthetic: true };
      gs.push(g); have[sg] = g;
    }
    if(!g.prog) g.prog = [];
    g.prog.push(String(e.titre||''));
    if(g.synthetic) g.items.push({ titre: String(e.titre||''), texte: '', matiere: 'MATHÉMATIQUE', classe: S.classe, dossier: e.dossier, sa: e.sa });
  });
  gs.sort(function(a,b){ var x = keyNums(a), y = keyNums(b); return (x[0]-y[0]) || (x[1]-y[1]) || (x[2]-y[2]); });
  return gs;
}
function groupsRaw(){
  var tp = T(S.type); if(!tp) return [];
  var list = (typeof resumesCache !== 'undefined' && resumesCache ? resumesCache : []).filter(function(r){
    return r.classe === S.classe && matOf(tp).test(normUp(r.matiere));
  });
  try{ if(typeof compareResumes === 'function') list.sort(compareResumes); }catch(e){}
  var mats = {}; list.forEach(function(r){ mats[r.matiere] = 1; });
  var multi = Object.keys(mats).length > 1;
  var map = {}, order = [];
  list.forEach(function(r){
    var p = []; addPart(p,'Unité',r.unite); addPart(p,'Dossier',r.dossier); addPart(p,'SA',r.sa);
    var key = (multi ? r.matiere+' · ' : '') + (p.join(' · ') || 'Sans SA');
    if(!map[key]){ map[key] = { key:key, items:[] }; order.push(key); }
    var dup = map[key].items.some(function(x){ return x.titre===r.titre && x.sequence===r.sequence && plainText(x.texte)===plainText(r.texte); });
    if(!dup) map[key].items.push(r);   // un résumé enregistré deux fois n'est compté qu'une fois
  });
  return order.map(function(k){ return map[k]; });
}
function selectedResumes(){
  var gs = groups().filter(function(g){ return S.sel[g.key]; });
  var out = [], i = 0, more = true;
  while(more && out.length < 20){
    more = false;
    for(var k=0;k<gs.length && out.length<20;k++){ if(gs[k].items[i]){ out.push(gs[k].items[i]); more = true; } }
    i++;
  }
  return out;
}
function plainText(s){ return String(s||'').replace(/<[^>]*>/g,' ').replace(/[#*_`>]+/g,' ').replace(/\s+/g,' ').trim(); }

/* ------------------------------------------------------------------ */
/* Écrans                                                              */
/* ------------------------------------------------------------------ */
function go(step){ S.step = step; S.err = ''; render(); window.scrollTo(0,0); }

function screenType(){
  var chips = CLASSES.map(function(c){
    var ok = !!CLASSES_OK[c];
    return '<button type="button" class="ep-chip'+(S.classe===c?' on':'')+(ok?'':' off')+'" '+(ok?'onclick="EPH.classe(\''+c+'\')"':'disabled title="Bientôt disponible"')+'>'+c+'</button>';
  }).join('');
  var cards = TYPES.map(function(t,i){
    return '<div class="fichecard picker-card pc-stack picker-card--'+t.color+'" onclick="EPH.type(\''+t.key+'\')">'
      + '<div class="picker-icon pi-book">'+(typeof BOOK_ICON !== 'undefined' ? BOOK_ICON : '')+'</div>'
      + '<h3>'+esc(t.label)+'</h3><p style="font-size:11.5px;color:var(--ink-soft)">Durée : '+esc(dureeOf(t))+'</p></div>';
  }).join('');
  return '<div class="masthead" style="border-bottom:none;margin-bottom:12px"><div><span class="eyebrow">Épreuves</span><h1>Évaluations du <em>mois</em></h1></div></div>'
    + '<p class="ep-note">Choisis la classe et la matière : l\u2019appli compose toute l\u2019épreuve avec son corrigé, à partir des SA que tes élèves ont déjà étudiées.</p>'
    + '<span class="ep-lbl" style="font-size:12px;font-weight:700;color:var(--ink-soft)">Classe</span><div class="ep-chips">'+chips+'</div>'
    + '<div class="grid grid-2">'+cards+'</div>';
}

/* Niveau 1 à 3 selon l'avancement dans le programme : part des SA cochées sur toutes celles de la matière ;
   sans SA (leçons saisies à la main), on se base sur le mois dans l'année scolaire (septembre → juin). */
function niveauAuto(){
  var gs = groups(), n = gs.length;
  if(n){
    var k = gs.filter(function(g){ return S.sel[g.key]; }).length, r = k/n;
    return r < 0.34 ? 1 : (r < 0.67 ? 2 : 3);
  }
  var m = MOIS.indexOf(String(S.mois||'').split(' ')[0]);
  if(m < 0) return 2;
  var pos = m >= 8 ? m-8 : m+4;
  return pos < 3 ? 1 : (pos < 6 ? 2 : 3);
}
function goOff(){ return (!selectedResumes().length && !S.notions.trim()) || !S.mois; }
/* Le bouton « Générer » n'est JAMAIS désactivé : un état « grisé » pouvait rester bloqué (liste des résumés chargée après coup, liste déroulante du mois sur Android…). Ce qui manque est expliqué au clic. */
function updateGo(){ if(S.err){ S.err = ''; var e = document.querySelector('.ep-err'); if(e && e.parentNode) e.parentNode.removeChild(e); } }
function missing(){ return !S.mois ? 'Choisis le mois de l\u2019évaluation.' : ((!selectedResumes().length && !S.notions.trim()) ? 'Coche au moins une SA ou écris une leçon à couvrir.' : ''); }

/* Type de texte à faire produire (expression écrite) : ceux étudiés dans les fiches prêtes */
function texteChoix(){
  if(S.type!=='ee') return '';
  if(!S.txtOpen){
    var cur = TEXTES.filter(function(x){ return x.key===S.texte; })[0];
    return '<span class="ep-lbl">Type de texte à produire</span><div class="ep-sum"><span>✓ '+esc(cur ? cur.label : 'Automatique')+'</span><button type="button" onclick="EPH.txtEdit()">Modifier</button></div>';
  }
  var chips = '<button type="button" class="ep-chip'+(!S.texte?' on':'')+'" onclick="EPH.texte(\'\')">Automatique</button>'
    + TEXTES.map(function(t){ return '<button type="button" class="ep-chip'+(S.texte===t.key?' on':'')+'" onclick="EPH.texte(\''+t.key+'\')">'+esc(t.label)+'</button>'; }).join('');
  return '<span class="ep-lbl">Type de texte à produire</span><div class="ep-chips">'+chips+'</div>'
    + '<p class="ep-note">« Automatique » reconnaît le type de texte d\u2019après les SA cochées, sinon en choisit un parmi ceux étudiés en classe.</p>';
}
function texteAuto(){
  var txt = normUp(selectedResumes().map(function(r){ return r.titre; }).join(' ')+' '+groups().filter(function(g){ return S.sel[g.key]; }).map(function(g){ return g.key; }).join(' ')+' '+S.notions).toLowerCase();
  var order = ['admin','portrait','affiche','compte','conte','article','narration','lettre'];
  for(var i=0;i<order.length;i++){
    var t = TEXTES.filter(function(x){ return x.key===order[i]; })[0];
    if(t && t.mots.test(txt)) return t.key;
  }
  return TEXTES[S.seed % TEXTES.length].key;
}

function screenConfig(){
  var tp = T(S.type), gs = groups();
  var loading = (typeof resumesLoading !== 'undefined' && resumesLoading);
  var list;
  var failed = (typeof resumesError !== 'undefined' && resumesError);
  if(loading || (typeof resumesCache !== 'undefined' && resumesCache === null && !failed)){
    list = '<div class="ep-wait" style="padding:20px"><div class="ep-spin"></div>Chargement des résumés…</div>';
  } else if(!gs.length){
    list = '<p class="ep-note">'+(failed ? 'Impossible de charger les résumés pour le moment.' : 'Aucun résumé de '+esc(tp.label)+' en '+esc(S.classe)+' pour le moment.')+' Écris ci-dessous les leçons à couvrir (une par ligne) pour générer quand même l\u2019épreuve.</p>';
  } else {
    var nSel = gs.filter(function(g){ return S.sel[g.key]; }).length;
    if(!S.saOpen && nSel){
      var noms = gs.filter(function(g){ return S.sel[g.key]; }).map(function(g){ return g.key; });
      list = '<div class="ep-sum"><span>✓ '+nSel+' SA cochée'+(nSel>1?'s':'')+' sur '+gs.length+'<small>'+esc(noms.length>3 ? noms.slice(0,3).join(' ; ')+' …' : noms.join(' ; '))+'</small></span><button type="button" onclick="EPH.saEdit()">Modifier</button></div>';
    } else
    list = '<div style="display:flex;gap:8px;margin:6px 0 8px"><button class="upto" style="flex:1;padding:8px;border:1.5px solid var(--line);border-radius:10px;background:#fff;font-weight:700;color:var(--blue);font-size:12.5px" onclick="EPH.all(true)">Tout cocher</button>'
      + '<button style="flex:1;padding:8px;border:1.5px solid var(--line);border-radius:10px;background:#fff;font-weight:700;color:var(--ink-soft);font-size:12.5px" onclick="EPH.all(false)">Tout décocher</button></div>'
      + '<p class="ep-note">'+nSel+' sur '+gs.length+' SA cochée'+(nSel>1?'s':'')+'. Astuce : « jusqu\u2019ici » coche tout ce qui précède.</p>'
      + gs.map(function(g,i){
          var on = !!S.sel[g.key];
          return '<div class="ep-row'+(on?' on':'')+'" onclick="EPH.toggle('+i+')"><span class="ck">'+(on?'✓':'')+'</span>'
            + '<span class="tt">'+esc(g.key)+'<small>'+(g.synthetic ? 'Programme : '+esc(String((g.items[0]&&g.items[0].titre)||'').slice(0,80)) : g.items.length+' résumé'+(g.items.length>1?'s':'')+(g.prog&&g.prog.length ? ' · '+esc(String(g.prog[0]).slice(0,60)) : ''))+'</small></span>'
            + '<button type="button" class="upto" onclick="event.stopPropagation();EPH.upto('+i+')">jusqu\u2019ici</button></div>';
        }).join('') + (nSel ? '<button type="button" class="ep-btn" onclick="EPH.saDone()">Terminé — afficher la suite</button>' : '');
  }
  var hint = S.type==='maths' ? '<p class="ep-note">Les exercices sont choisis selon tes SA et le programme de '+esc(S.classe)+' ; plus tu as avancé dans le programme (SA cochées), plus l\u2019épreuve est exigeante.</p>' : '';
  var need = goOff();
  return '<button class="backbtn" onclick="EPH.back()">← Retour</button>'
    + '<div class="masthead" style="border-bottom:none;margin-bottom:8px"><div><span class="eyebrow">Épreuves — '+esc(S.classe)+'</span><h1>'+esc(tp.label)+'</h1></div></div>'
    + '<div class="ep-cfg">'
    + '<span class="ep-lbl">1. Où en êtes-tu dans la matière ?</span>'+list+hint
    + '<span class="ep-lbl">Autres leçons à couvrir (facultatif, une par ligne)</span><textarea oninput="EPH.notions(this.value)" placeholder="Ex. Les fractions décimales">'+esc(S.notions)+'</textarea>'
    + texteChoix()
    + '<span class="ep-lbl">2. En-tête de l\u2019épreuve</span>'
    + '<input type="text" placeholder="École (ex. EPP Zogbodomey)" value="'+esc(S.ecole)+'" oninput="EPH.f(\'ecole\',this.value)">'
    + '<div style="height:8px"></div><input type="text" placeholder="Circonscription scolaire (ex. Zogbodomey)" value="'+esc(S.circ)+'" oninput="EPH.f(\'circ\',this.value)">'
    + '<div style="height:8px"></div><div style="display:flex;gap:8px"><input type="text" placeholder="Année scolaire" value="'+esc(S.annee)+'" oninput="EPH.f(\'annee\',this.value)"></div>'
    + '<span class="ep-lbl">Mois de l\u2019évaluation</span>'
    + '<select class="ep-sel" onchange="EPH.mois(this.value)"><option value="">Choisis le mois…</option>'+MOIS.map(function(m){ return '<option value="'+m+'"'+(S.mois===m?' selected':'')+'>'+m.charAt(0)+m.slice(1).toLowerCase()+'</option>'; }).join('')+'</select>'
    + (S.err ? '<div class="ep-err">'+esc(S.err)+'</div>' : '')
    + '<button type="button" class="ep-btn" id="epGo" style="touch-action:manipulation" onclick="EPH.generate()">Générer l\u2019épreuve</button>'
    + '<p class="ep-note" style="text-align:center">3 épreuves maximum par jour.</p>'
    + '</div>';
}

function screenWait(){
  return '<div class="ep-wait"><div class="ep-spin"></div><b>Rédaction de l\u2019épreuve…</b><br><span style="font-size:12.5px">Cela peut prendre jusqu\u2019à une minute.</span></div>';
}

function screenResult(){
  var tp = T(S.type);
  var pv = function(pages, id){
    return pages.map(function(p){ return '<div class="ep-pv" data-ep="'+id+'">'+p+'</div>'; }).join('');
  };
  return '<button class="backbtn" onclick="EPH.edit()">← Modifier la sélection</button>'
    + '<div class="masthead" style="border-bottom:none;margin-bottom:8px"><div><span class="eyebrow">Épreuve prête</span><h1>'+esc(tp.label)+' — '+esc(S.classe)+'</h1></div></div>'
    + '<button class="ep-btn" onclick="EPH.pdf(false)">Télécharger l\u2019épreuve (PDF)</button>'
    + '<button class="ep-btn alt" onclick="EPH.pdf(true)">Télécharger le corrigé type (PDF)</button>'
    + '<button class="ep-btn alt" onclick="EPH.generate()">Générer une autre épreuve</button>'
    + '<div style="height:12px"></div>'
    + '<span class="ep-note" style="font-weight:700">Aperçu de l\u2019épreuve</span>' + pv(S.pages,'ep')
    + '<span class="ep-note" style="font-weight:700">Aperçu du corrigé type</span>' + pv(S.pagesCo,'co');
}

function fitPreviews(){
  var nodes = document.querySelectorAll('.ep-pv');
  for(var i=0;i<nodes.length;i++){
    var box = nodes[i], pg = box.firstElementChild; if(!pg) continue;
    var w = box.clientWidth || 340, k = w / PAGE_W;
    pg.style.transform = 'scale('+k+')';
    box.style.height = Math.round(PAGE_H*k)+'px';
  }
}

function renderEpreuves(){
  ensureStyle(); loadEntete();
  var vp = document.getElementById('viewport');
  if(!vp) return;
  if(S.step==='config' && typeof resumesCache !== 'undefined' && resumesCache === null && !(typeof resumesLoading !== 'undefined' && resumesLoading) && !(typeof resumesError !== 'undefined' && resumesError)){
    setTimeout(function(){ if(typeof loadResumes==='function') loadResumes(); }, 0);
  }
  var html;
  if(S.step==='config') html = screenConfig();
  else if(S.step==='wait') html = screenWait();
  else if(S.step==='result' && S.pages) html = screenResult();
  else { S.step = 'type'; html = screenType(); }
  vp.innerHTML = html;
  if(S.step==='result') setTimeout(fitPreviews, 30);
}

/* ------------------------------------------------------------------ */
/* Actions                                                             */
/* ------------------------------------------------------------------ */
function resumesText(){
  return selectedResumes().map(function(r){ return r.titre+' '+plainText(r.texte).slice(0,700); }).join(' ') + ' ' + S.notions
    + ' ' + groups().filter(function(g){ return S.sel[g.key]; }).map(function(g){ return g.key + ' ' + (g.prog||[]).join(' '); }).join(' ');
}

function buildPages(doc){
  var ent = { ecole:S.ecole.trim(), circ:S.circ.trim(), annee:S.annee.trim(), mois:S.mois.trim() };
  S.doc = doc;
  S.pages = paginate(doc, ent, 'ep');
  S.pagesCo = paginate(doc, ent, 'co');
}

/* Figures : chaque SVG devient une image PNG à sa taille exacte avant la capture PDF (évite les figures coupées). */
function rasterSvgs(root){
  var list = Array.prototype.slice.call(root.querySelectorAll('svg'));
  return list.reduce(function(chain, svg){
    return chain.then(function(){
      return new Promise(function(done){
        try{
          var W = parseInt(svg.getAttribute('width'),10) || Math.round(svg.getBoundingClientRect().width);
          var H = parseInt(svg.getAttribute('height'),10) || Math.round(svg.getBoundingClientRect().height);
          if(!W || !H){ done(); return; }
          var c = svg.cloneNode(true); c.setAttribute('width',W); c.setAttribute('height',H);
          if(!c.getAttribute('xmlns')) c.setAttribute('xmlns','http://www.w3.org/2000/svg');
          var url = 'data:image/svg+xml;charset=utf-8,'+encodeURIComponent(new XMLSerializer().serializeToString(c));
          var im = new Image();
          im.onload = function(){
            try{
              var k = 3, cv = document.createElement('canvas'); cv.width = W*k; cv.height = H*k;
              var cx = cv.getContext('2d'); cx.fillStyle = '#fff'; cx.fillRect(0,0,cv.width,cv.height); cx.drawImage(im,0,0,cv.width,cv.height);
              var out = new Image(); out.width = W; out.height = H; out.src = cv.toDataURL('image/png');
              out.style.cssText = 'display:block;margin:0 auto;width:'+W+'px;height:'+H+'px';
              svg.parentNode.replaceChild(out, svg);
            }catch(e){}
            done();
          };
          im.onerror = function(){ done(); };
          im.src = url;
        }catch(e){ done(); }
      });
    });
  }, Promise.resolve());
}

var EPH = window.EPH = {
  classe: function(c){ if(!CLASSES_OK[c]) return; S.classe = c; S.sel = {}; S.saOpen = true; S.txtOpen = true; render(); },
  type: function(k){ S.type = k; S.saOpen = true; S.txtOpen = true; S.sel = {}; S.notions = ''; S.err = ''; S.step = 'config'; render(); window.scrollTo(0,0); },
  back: function(){ S.step = 'type'; render(); },
  edit: function(){ S.step = 'config'; render(); },
  toggle: function(i){ var g = groups()[i]; if(!g) return; S.sel[g.key] = !S.sel[g.key]; render(); },
  all: function(v){ groups().forEach(function(g){ S.sel[g.key] = v; }); render(); },
  upto: function(i){ groups().forEach(function(g,k){ S.sel[g.key] = k<=i; }); render(); },
  notions: function(v){ S.notions = v; updateGo(); },
  mois: function(v){ S.mois = v; S.err = ''; updateGo(); },
  texte: function(k){ S.texte = k; S.txtOpen = false; render(); },
  txtEdit: function(){ S.txtOpen = true; render(); },
  saDone: function(){ S.saOpen = false; render(); window.scrollTo(0,0); },
  saEdit: function(){ S.saOpen = true; render(); },
  f: function(k,v){ S[k] = v; saveEntete(); },
  generate: async function(){
    if(S.step==='wait') return;   // déjà en cours : évite le double envoi
    var tp = T(S.type); saveEntete();
    var manque = missing();
    if(manque){ S.err = manque; S.step = 'config'; render(); return; }
    S.seed = newSeed(); S.lv = niveauAuto(); S.err = ''; S.step = 'wait'; render(); window.scrollTo(0,0);
    try{
      var doc;
      if(S.type==='maths'){
        // calculé dans le navigateur, mais compté dans les 3 épreuves du jour
        try{
          var rc = await fetch('/api/generate-epreuve', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(Object.assign({ type:'maths', claim:true }, ident())) });
          var dc = await rc.json().catch(function(){ return null; });
          if(dc && dc.reason==='limit') throw new Error(LIMIT_MSG);
        }catch(ec){ if(ec && ec.message===LIMIT_MSG) throw ec; }   // réseau coupé : le calcul reste possible
        await new Promise(function(r){ setTimeout(r,50); });
        doc = mathsDoc(resumesText(), S.seed, S.classe, S.lv);
      } else {
        var body = {
          type: S.type, classe: S.classe, mois: S.mois, seed: S.seed, niveau: S.lv, notions: S.notions.trim(),
          texteType: S.type==='ee' ? (S.texte || texteAuto()) : '',
          resumes: selectedResumes().map(function(r){ return { titre:r.titre, texte:plainText(r.texte).slice(0,600) }; })
        };
        var id = ident(); body.phone = id.phone; body.code = id.code; body.deviceId = id.deviceId;
        var data = null;
        for(var essai=0; essai<3; essai++){
          var ctrl = (typeof AbortController!=='undefined') ? new AbortController() : null;
          var to = setTimeout(function(){ if(ctrl) ctrl.abort(); }, 90000);
          try{
            body.seed = S.seed + essai*13;
            var res = await fetch('/api/generate-epreuve', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(body), signal: ctrl ? ctrl.signal : undefined });
            data = await res.json().catch(function(){ return null; });
          } catch(netErr){
            data = null;   // réseau coupé ou délai : on réessaie
          } finally { clearTimeout(to); }
          if(data && data.ok) break;
          if(data && (data.reason==='no-content' || data.reason==='quota' || data.reason==='invalid-params' || data.reason==='limit')) break;
          if(essai<2) await new Promise(function(r){ setTimeout(r, 3000*(essai+1)); });   // laisse passer une saturation passagère
        }
        if(!data || !data.ok){
          var rs = data && data.reason;
          throw new Error(rs==='limit' ? LIMIT_MSG
            : rs==='no-content' ? 'Coche au moins une SA ou écris une leçon à couvrir.'
            : rs==='quota' ? 'Le forfait quotidien de la rédaction automatique est épuisé. Il se renouvelle chaque jour : réessaie plus tard.'
            : !data ? 'La connexion a été interrompue. Vérifie ton réseau puis appuie de nouveau sur « Générer l\u2019épreuve ».'
            : 'La rédaction automatique est très sollicitée en ce moment (ce n\u2019est pas une limite atteinte). Réessaie dans une minute.');
        }
        var e = data.epreuve;
        doc = { type:S.type, support:e.support, tache:e.tache, items:e.items||[], consigne:e.consigne||[], corrige:(e.corrige&&e.corrige.length)?e.corrige:[] };
        if(!doc.corrige.length) doc.corrige = [{ item:'Corrigé', lignes:['Réponses à valider par l\u2019enseignant selon les résumés de cours.'] }];
      }
      buildPages(doc);
      S.step = 'result';
    }catch(err){
      S.err = (err && err.name==='AbortError') ? 'Le délai est dépassé. Réessaie.' : ((err && err.message) || 'Impossible de générer l\u2019épreuve.');
      S.step = 'config';
    }
    render();
  },
  pdf: async function(co){
    if(typeof html2pdf === 'undefined' || typeof PDFLib === 'undefined'){
      alert("La bibliothèque PDF n'a pas pu se charger (pas de connexion). Réessaie avec une connexion active.");
      return;
    }
    var pages = co ? S.pagesCo : S.pages, tp = T(S.type);
    var name = (co ? 'Corrige_' : 'Epreuve_') + tp.key + '_' + S.classe + '_' + String(S.mois||'').replace(/[^\w]+/g,'_') + '.pdf';
    var root = document.getElementById('pdf-root'), oldW = root.style.width, oldHtml = root.innerHTML;
    try{
      dlProgressStart(co ? 'Création du corrigé en PDF' : 'Création de l\u2019épreuve en PDF', 'Mise en page…');
      root.style.width = PAGE_W+'px';
      var PD = PDFLib.PDFDocument, merged = await PD.create();
      for(var i=0;i<pages.length;i++){
        root.innerHTML = pages[i];
        await rasterSvgs(root);
        await waitForImages(root);
        var el = root.firstElementChild;
        var opt = { margin:0, image:{ type:'jpeg', quality:0.95 },
          html2canvas:{ scale:2.2, useCORS:true, backgroundColor:'#ffffff', scrollX:0, scrollY:0, width:PAGE_W, height:PAGE_H, windowWidth:PAGE_W, windowHeight:PAGE_H },
          jsPDF:{ unit:'mm', format:'a4', orientation:'portrait', compress:true } };
        var pdf = await html2pdf().set(opt).from(el).toPdf().get('pdf');
        var src = await PD.load(pdf.output('arraybuffer'));
        var cp = await merged.copyPages(src, [0]);
        merged.addPage(cp[0]);
        dlProgressSet(Math.round((i+1)/pages.length*100), 'Page '+(i+1)+' / '+pages.length);
      }
      var bytes = await merged.save();
      downloadPdfBlob(new Blob([bytes], { type:'application/pdf' }), name);
    }catch(e){
      try{ dlProgressHide(); }catch(x){}
      alert('Impossible de créer le PDF : '+(e && e.message ? e.message : e));
    }finally{
      root.innerHTML = oldHtml; root.style.width = oldW;
    }
  }
};

/* ------------------------------------------------------------------ */
/* Passerelles pour la « Fiche d'intégration » (integration.js)        */
/* ------------------------------------------------------------------ */
/* HTML d'un support d'épreuve → texte simple (une fiche se remplit en texte brut). */
function htmlTxt(h){
  return String(h==null ? '' : h)
    .replace(/<\s*br\s*\/?>/gi,'\n').replace(/<\/(p|div|tr|li|h\d)>/gi,'\n').replace(/<\/(td|th)>/gi,' | ')
    .replace(/<li[^>]*>/gi,'\u2022 ').replace(/<[^>]*>/g,'')
    .replace(/&nbsp;/g,' ').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"').replace(/&#39;|&apos;/g,"'").replace(/&amp;/g,'&')
    .replace(/&#(\d+);/g,function(m,n){ return String.fromCharCode(+n); })
    .replace(/ \| \n/g,'\n').replace(/[ \t]+\n/g,'\n').replace(/\n{3,}/g,'\n\n').trim();
}
/* Image réduite (JPEG) : une fiche est enregistrée sur l'appareil, on évite les figures trop lourdes. */
function shrinkImg(src, maxW){
  return new Promise(function(done){
    try{
      var im = new Image();
      im.onload = function(){
        try{
          var k = Math.min(1, maxW/(im.naturalWidth||maxW)), cv = document.createElement('canvas');
          cv.width = Math.max(1,Math.round((im.naturalWidth||maxW)*k)); cv.height = Math.max(1,Math.round((im.naturalHeight||maxW)*k));
          var cx = cv.getContext('2d'); cx.fillStyle = '#fff'; cx.fillRect(0,0,cv.width,cv.height); cx.drawImage(im,0,0,cv.width,cv.height);
          done(cv.toDataURL('image/jpeg',0.82));
        }catch(e){ done(src); }
      };
      im.onerror = function(){ done(''); };
      im.src = src;
    }catch(e){ done(''); }
  });
}
/* Résumés de la classe et de la matière correspondant au niveau (1 = début de programme, 2 = en cours, 3 = fin) :
   même principe que les SA cochées de l'onglet Épreuves. */
EPH.forIntegration = function(classe, type, lv){
  var keep = { classe:S.classe, type:S.type, sel:S.sel, notions:S.notions };
  var out = { resumes:[], text:'', n:0 };
  try{
    S.classe = classe; S.type = type; S.sel = {}; S.notions = '';
    var gs = groups(), n = gs.length;
    var k = n ? Math.max(1, Math.ceil(n*(lv===1 ? 0.33 : (lv===2 ? 0.67 : 1)))) : 0;
    gs.slice(0,k).forEach(function(g){ S.sel[g.key] = true; });
    out.resumes = selectedResumes().map(function(r){ return { titre:r.titre, texte:plainText(r.texte).slice(0,600) }; });
    out.text = resumesText();
    out.n = n;
  }catch(e){}
  S.classe = keep.classe; S.type = keep.type; S.sel = keep.sel; S.notions = keep.notions;
  return out;
};
/* Épreuve générée (doc) → texte « Consignes » + « Résultats attendus » + figures (images) d'une fiche. */
EPH.docToFiche = async function(doc){
  var L = [], R = [], imgs = [];
  var sup = doc.support || {}, isDessin = doc.type==='dessin';
  var st = htmlTxt(sup.texte);
  if(st) L.push((isDessin ? 'Situation' : 'Support'+(sup.titre ? ' : '+htmlTxt(sup.titre) : ''))+'\n'+st);
  var tache = htmlTxt(doc.tache).replace(/^T[âa]che\s*:\s*/i,'');
  if(tache) L.push('Tâche : '+tache);
  if(isDessin){
    var cons = (doc.consigne||[]).map(function(c){ return htmlTxt(c).replace(/^[\u2022\-\s]+/,''); }).filter(Boolean);
    if(cons.length) L.push('Consigne : sur une feuille, représente :\n'+cons.map(function(c){ return '\u2022 '+c; }).join('\n'));
  }
  (doc.items||[]).forEach(function(it,k){
    var b = ['Item '+(k+1)];
    if(it.intro) b.push(htmlTxt(it.intro));
    if(it.tableHtml) b.push(htmlTxt(it.tableHtml));
    (it.questions||[]).forEach(function(q){ var qt = htmlTxt(q).replace(/\n+/g,' '); b.push(/^[A-Da-d][.)]\s/.test(qt) ? qt : '\u2022 '+qt); });
    L.push(b.join('\n'));
  });
  (doc.corrige||[]).forEach(function(c,i){
    R.push((c.item||('Item '+(i+1)))+'\n'+(c.lignes||[]).map(function(l){ var lt = htmlTxt(l).replace(/\n+/g,' '); return /^[A-Da-d][.)]\s/.test(lt) ? lt : '\u2022 '+lt; }).join('\n'));
  });
  try{
    var box = document.createElement('div'); box.style.cssText = 'position:absolute;left:-9999px;top:0;width:700px;background:#fff';
    (doc.items||[]).forEach(function(it){
      if(it.figureHtml) box.insertAdjacentHTML('beforeend','<div>'+it.figureHtml+'</div>');
      if(it.figure) box.insertAdjacentHTML('beforeend','<div>'+circuitSvg(it.figure)+'</div>');
    });
    if(box.firstChild){
      document.body.appendChild(box);
      try{ await rasterSvgs(box); }catch(e){}
      var list = Array.prototype.slice.call(box.querySelectorAll('img')).filter(function(im){ return /^data:image/.test(im.src); }).slice(0,3);
      for(var i=0;i<list.length;i++){ var u = await shrinkImg(list[i].src, 560); if(u) imgs.push(u); }
      document.body.removeChild(box);
    }
  }catch(e){}
  return { consignes:L.join('\n\n'), resultats:R.join('\n\n'), images:imgs };
};

EPH._groups = groups; EPH._S = S;
EPH.raster = rasterSvgs;
EPH._maths = mathsDoc; EPH._render = renderEpreuves;   // utilisés pour les tests

window.openEpreuves = function(){
  S.step = (S.step==='result' && S.pages) ? 'result' : (S.type && S.step==='config' ? 'config' : 'type');
  state = { view:'epreuves' };
  render();
  window.scrollTo(0,0);
};
window.renderEpreuves = renderEpreuves;
window.addEventListener('resize', function(){ if(S.step==='result') fitPreviews(); });

/* Pour les essais hors navigateur (Node) */
if(typeof module !== 'undefined' && module.exports){ module.exports = { mathsDoc:mathsDoc, bareme:bareme, circuitSvg:circuitSvg, shapesSvg:shapesSvg, fr:fr }; }
})();

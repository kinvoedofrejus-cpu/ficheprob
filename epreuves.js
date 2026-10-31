/*
  ONGLET « ÉPREUVES » — épreuves d'activité d'intégration générées automatiquement.

  L'enseignant choisit la classe, la matière et les SA déjà étudiées (tirées des résumés du site), puis
  l'année scolaire, la circonscription et l'école (affichées dans l'en-tête). L'appli sort l'épreuve et son
  corrigé avec barème sur 20, en PDF.

  - Mathématiques : TOUT est calculé ici (valeurs, figures SVG, corrigé) → le corrigé est toujours exact.
  - Autres matières : le texte est rédigé par l'IA (/api/generate-epreuve) à partir des résumés choisis ;
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
var CLASSES_OK = { CM2: true };          // classes déjà ouvertes (les autres arrivent ensuite)
var TYPES = [
  { key:'maths',   label:'Mathématiques',                titre:'MATHÉMATIQUES',                  duree:'1 h',    mat:/^MATH/,                                         color:'blue'   },
  { key:'ee',      label:'Français · Expression écrite', titre:'FRANÇAIS — EXPRESSION ÉCRITE',   duree:'30 min', mat:/^EXPRESSION/,                                   color:'green',  dbl:true },
  { key:'lecture', label:'Français · Lecture',           titre:'FRANÇAIS — LECTURE',             duree:'30 min', mat:/^(LECTURE|GRAMMAIRE|ORTHOGRAPHE|CONJUGAISON|VOCABULAIRE)/, color:'orange' },
  { key:'es',      label:'Éducation sociale (ES)',       titre:'ÉDUCATION SOCIALE (ES)',         duree:'45 min', mat:/^ES\b/,                                         color:'purple' },
  { key:'est',     label:'EST',                          titre:'ÉDUCATION SCIENTIFIQUE ET TECHNOLOGIQUE (EST)', duree:'45 min', mat:/^EST\b/,                 color:'blue'   },
  { key:'dessin',  label:'Dessin',                       titre:'DESSIN',                         duree:'30 min', mat:/^DESSIN/,                                       color:'green',  dbl:true }
];
var MOIS = ['JANVIER','FÉVRIER','MARS','AVRIL','MAI','JUIN','JUILLET','AOÛT','SEPTEMBRE','OCTOBRE','NOVEMBRE','DÉCEMBRE'];
var LS_KEY = 'fpb_epreuve_entete';
var PAGE_W = 794, PAGE_H = 1122, PAD_X = 40, PAD_TOP = 30, PAD_BOT = 30, FOOT_H = 22;

var S = {
  step: 'type', classe: 'CM2', type: null, sel: {}, notions: '',
  ecole: '', circ: '', annee: '', mois: '',
  seed: 0, doc: null, pages: null, pagesCo: null, err: '', loaded: false
};

function T(key){ for(var i=0;i<TYPES.length;i++) if(TYPES[i].key===key) return TYPES[i]; return null; }
function esc(s){ return (typeof escapeHtml === 'function') ? escapeHtml(String(s==null?'':s)) : String(s==null?'':s).replace(/[&<>"]/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c];}); }
function norm(s){ return String(s||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase(); }
function normUp(s){ return norm(s).toUpperCase(); }

function defAnnee(){ var d=new Date(), y=d.getFullYear(); return d.getMonth()>=8 ? y+'-'+(y+1) : (y-1)+'-'+y; }
function defMois(){ var d=new Date(); return MOIS[d.getMonth()]+' '+d.getFullYear(); }
function loadEntete(){
  if(S.loaded) return; S.loaded = true;
  var o = {}; try{ o = JSON.parse(localStorage.getItem(LS_KEY)||'{}') || {}; }catch(e){}
  S.ecole = o.ecole || ''; S.circ = o.circ || ''; S.annee = o.annee || defAnnee(); S.mois = o.mois || defMois();
}
function saveEntete(){
  try{ localStorage.setItem(LS_KEY, JSON.stringify({ ecole:S.ecole, circ:S.circ, annee:S.annee, mois:S.mois })); }catch(e){}
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
function sv(w,h,inner,maxw){ return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 '+w+' '+h+'" style="width:100%;max-width:'+(maxw||560)+'px;height:auto;display:block;margin:0 auto" font-family="Arial,Helvetica,sans-serif" font-size="15">'+inner+'</svg>'; }
function tx(x,y,t,anchor){ return '<text x="'+x+'" y="'+y+'" text-anchor="'+(anchor||'middle')+'" fill="'+INK+'">'+esc(t)+'</text>'; }

/* shapes : tableau de { k:'carre'|'rect'|'tri'|'cercle', ... } posées sur 3 colonnes */
function shapesSvg(shapes){
  var out = '', xs = [80,300,540];
  shapes.forEach(function(s,i){
    var cx = xs[i], yb = 138;
    if(s.k==='carre'){
      out += '<rect x="'+(cx-50)+'" y="'+(yb-100)+'" width="100" height="100" fill="'+FILL+'" stroke="'+INK+'" stroke-width="2"/>';
      out += tx(cx,yb+20,s.c+' m') + tx(cx+58,yb-46,s.c+' m','start');
    } else if(s.k==='rect'){
      out += '<rect x="'+(cx-80)+'" y="'+(yb-80)+'" width="160" height="80" fill="'+FILL+'" stroke="'+INK+'" stroke-width="2"/>';
      out += tx(cx,yb+20,s.L+' m') + tx(cx+88,yb-36,s.l+' m','start');
    } else if(s.k==='tri'){
      var x0 = cx-50;
      out += '<polygon points="'+x0+','+yb+' '+(x0+100)+','+yb+' '+x0+','+(yb-110)+'" fill="'+FILL+'" stroke="'+INK+'" stroke-width="2"/>';
      out += '<polyline points="'+x0+','+(yb-12)+' '+(x0+12)+','+(yb-12)+' '+(x0+12)+','+yb+'" fill="none" stroke="'+INK+'" stroke-width="1.5"/>';
      out += tx(cx,yb+20,s.b+' m') + tx(x0-8,yb-50,s.h+' m','end');
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
    ok = c.filter(function(v){ return v===mx; }).length === 1;
  }
  var cells = [];
  names.forEach(function(nm,i){ for(var k=0;k<c[i];k++) cells.push(nm); });
  cells = R.shuffle(cells);
  var cols = (N%4===0) ? 4 : 5;
  var imax = c.indexOf(Math.max.apply(null,c));
  function fq(n){ var p = n*100/N; var pc = (Math.abs(p-Math.round(p*10)/10) < 1e-9) ? ' (soit '+fr(Math.round(p*10)/10)+' %)' : ''; return n+'/'+N+(gcd(n,N)>1 ? ' = '+frac(n,N) : '')+pc; }
  return {
    ctx: 'Les '+N+' élèves de la classe choisissent chacun leur activité préférée : '+names[0].toLowerCase()+', '+names[1].toLowerCase()+', '+names[2].toLowerCase()+' ou '+names[3].toLowerCase()+'.',
    tags: 'effectif',
    intro: 'Voici les réponses recueillies auprès des '+N+' élèves :',
    tableHtml: gridTable(cells, cols),
    questions: [
      'Dénombre les élèves ayant choisi chaque activité et complète un tableau comportant les activités, les effectifs et les fréquences.',
      'Calcule l\u2019effectif moyen des quatre catégories d\u2019activités.',
      'Détermine la fréquence de l\u2019activité la plus choisie.'
    ],
    corrige: [
      names.map(function(nm,i){ return nm+' : effectif '+c[i]+', fréquence '+fq(c[i]); }).join(' ; ')+'.',
      'Effectif moyen = '+N+' ÷ 4 = '+fr(N/4)+'.',
      'Activité la plus choisie : '+names[imax].toLowerCase()+' ; fréquence = '+fq(c[imax])+'.'
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
      'Calcule le prix de '+n2+' '+obj[1]+'.',
      'Un élève paie '+fr(P*k)+' F CFA. Combien de '+obj[1]+' a-t-il achetés ?'
    ],
    corrige: [
      '3 → '+fr(P*3)+' F ; 5 → '+fr(P*5)+' F ; 8 → '+fr(P*8)+' F.',
      n2+' × '+fr(P)+' = '+fr(P*n2)+' F CFA.',
      fr(P*k)+' ÷ '+fr(P)+' = '+k+' '+obj[1]+'.'
    ]
  };
}
gProp.kw = [/proportionnal/g,/pourcentage/g,/regle de trois/g,/prix/g,/monnaie/g,/cout/g,/achat/g];

/* Item « géométrie plane » */
function gAires(R){
  var c = R.pick([10,12,15,20,25,30]), L = R.pick([40,50,60,80]), l = R.pick([20,25,30]);
  var b = R.pick([10,12,16,20,24,30]), h = R.pick([10,15,20,25,30]);
  var aC = c*c, aR = L*l, aT = b*h/2;
  return {
    ctx: 'L\u2019école aménage ensuite un espace composé de trois parties géométriques.',
    tags: 'aire',
    intro: 'L\u2019espace aménagé comprend un carré de '+c+' m de côté, un rectangle de '+L+' m de longueur et de '+l+' m de largeur, puis un triangle rectangle de base '+b+' m et de hauteur '+h+' m.',
    figureHtml: shapesSvg([{k:'carre',c:c},{k:'rect',L:L,l:l},{k:'tri',b:b,h:h}]),
    questions: ['Calcule l\u2019aire du carré et celle du rectangle.','Calcule l\u2019aire du triangle rectangle.','Détermine l\u2019aire totale de l\u2019espace aménagé.'],
    corrige: [
      'Carré : '+c+' × '+c+' = '+fr(aC)+' m² ; rectangle : '+L+' × '+l+' = '+fr(aR)+' m².',
      'Triangle : ('+b+' × '+h+') ÷ 2 = '+fr(aT)+' m².',
      fr(aC)+' + '+fr(aR)+' + '+fr(aT)+' = '+fr(aC+aR+aT)+' m².'
    ]
  };
}
gAires.kw = [/\baire/g,/surface/g,/carre/g,/rectangle/g,/triangle/g,/superficie/g];

function gPerim(R){
  var c = R.pick([10,12,15,20,25]), L = R.pick([30,40,50,60]), l = R.pick([15,20,25]), r = R.pick([5,7,10,14]);
  var pC = 4*c, pR = 2*(L+l), pO = rnd(2*3.14*r);
  return {
    ctx: 'L\u2019école clôture ensuite un espace composé de trois parties de formes différentes.',
    tags: 'perimetre',
    intro: 'L\u2019espace comprend un carré de '+c+' m de côté, un rectangle de '+L+' m de longueur et de '+l+' m de largeur, puis un bassin en forme de cercle de '+r+' m de rayon.',
    figureHtml: shapesSvg([{k:'carre',c:c},{k:'rect',L:L,l:l},{k:'cercle',r:r}]),
    questions: ['Calcule le périmètre du carré et celui du rectangle.','Calcule la circonférence du cercle (prends \u03c0 = 3,14).','Détermine la longueur totale de grillage nécessaire pour entourer les trois parties.'],
    corrige: [
      'Carré : 4 × '+c+' = '+pC+' m ; rectangle : 2 × ('+L+' + '+l+') = '+pR+' m.',
      'Cercle : 2 × 3,14 × '+r+' = '+fr(pO)+' m.',
      pC+' + '+pR+' + '+fr(pO)+' = '+fr(pC+pR+pO)+' m.'
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

function score(g, text, R){
  var s = 0;
  (g.kw||[]).forEach(function(re){ var m = text.match(re); if(m) s += Math.min(m.length,3); });
  return s + R.n()*0.6;
}
function best(list, text, R){
  var sc = list.map(function(g){ return { g:g, s:score(g,text,R) }; });
  sc.sort(function(a,b){ return b.s-a.s; });
  return sc[0].g;
}

var EVENTS = ['une journée récréative','la fête de fin d\u2019année','une journée de sport','une kermesse scolaire','la journée de l\u2019école propre'];

function mathsDoc(text, seed, classe){
  var R = mkR(seed), tn = norm(text);
  var g1 = best([gStats, gProp], tn, R);
  var g2 = best([gAires, gPerim], tn, R);
  var i1 = g1(R), i2 = g2(R);

  var qs = [qVolume, qDecimaux, qEncadrer, qFractionDe, qConversion, qDuree, qOperations];
  var ranked = qs.map(function(g){ return { g:g, s:score(g,tn,R) }; }).sort(function(a,b){ return b.s-a.s; }).slice(0,3).map(function(x){ return x.g; });
  ranked.sort(function(a,b){ return (b.first?1:0) - (a.first?1:0); });   // le volume (qui a une introduction) passe en premier
  var parts = ranked.map(function(g){ return g(R, tn); });
  var i3 = {
    intro: parts.map(function(p){ return p.intro; }).filter(Boolean).join(' '),
    questions: parts.map(function(p){ return p.q; }),
    corrige: parts.map(function(p){ return p.a; })
  };

  var ev = R.pick(EVENTS);
  var ctxs = [i1.ctx, i2.ctx].concat(parts.map(function(p){ return p.ctx; })).filter(Boolean);
  var support = 'Pour préparer '+ev+', une école mobilise les élèves de '+classe+' autour de plusieurs activités. '+ctxs.join(' ');
  return {
    type: 'maths',
    support: { titre: '', texte: support },
    tache: 'À partir des informations du support et des données de chaque item, effectue les calculs nécessaires pour aider l\u2019école à bien organiser '+ev+'.',
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
+ '.ep-chips{display:flex;gap:7px;flex-wrap:wrap;margin:4px 0 14px}'
+ '.ep-chip{padding:7px 14px;border-radius:999px;border:1.5px solid var(--line);background:#fff;font-weight:700;font-size:13px;color:var(--ink);cursor:pointer}'
+ '.ep-chip.on{background:var(--blue);border-color:var(--blue);color:#fff}'
+ '.ep-chip.off{opacity:.45;cursor:not-allowed}'
+ '.ep-btn{display:block;width:100%;margin:10px 0 0;padding:13px 16px;border:none;border-radius:14px;font-weight:800;font-size:14.5px;cursor:pointer;background:var(--blue);color:#fff}'
+ '.ep-btn.alt{background:#fff;color:var(--blue);border:2px solid var(--blue)}'
+ '.ep-btn:disabled{opacity:.5;cursor:not-allowed}'
+ '.ep-pv{width:100%;position:relative;overflow:hidden;border:1px solid var(--line);border-radius:10px;margin:0 0 12px;background:#fff;box-shadow:0 3px 12px rgba(11,42,82,.10)}'
+ '.ep-pv .ep-page{transform-origin:0 0;position:absolute;left:0;top:0}'
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
  var lines = String(q).split('\n');
  var html = '<b>'+L+'.</b> '+esc(stripLetter(lines[0]));
  for(var k=1;k<lines.length;k++) html += '<br>'+esc(lines[k]);
  return '<div class="ep-q">'+html+'</div>';
}

function entete(doc, ent, kind){
  var tp = T(doc.type);
  var dots = '.....................................';
  var title = kind==='co' ? 'CORRIGÉ ET BARÈME' : 'ÉPREUVE D\u2019ACTIVITÉ D\u2019INTÉGRATION';
  var sub = kind==='co' ? '<div class="ep-h5">Épreuve d\u2019activité d\u2019intégration — '+esc(S.classe)+'</div>' : '';
  return '<div class="ep-head">'
    + '<div class="ep-h1"><span>Circonscription scolaire de '+esc(ent.circ||dots)+'</span><span>Année scolaire '+esc(ent.annee||dots)+'</span></div>'
    + '<div class="ep-h2">École : '+esc(ent.ecole||dots)+'</div>'
    + '<div class="ep-h3">'+title+'</div>'
    + '<div class="ep-h4">'+esc(tp.titre)+' — '+esc(S.classe)+'</div>'
    + '<div class="ep-h5">'+esc(ent.mois||'')+' — Durée : '+esc(tp.duree)+'</div>'
    + sub
    + (kind==='co' ? '' : '<div class="ep-nom"><span>Nom et prénoms : ............................................................</span><span>Note : ......... / 20</span></div>')
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

/* Barème sur 20 : une note par ligne du corrigé, ajustée pour que le total fasse exactement 20. */
function bareme(corrige){
  var n = 0; corrige.forEach(function(c){ n += c.lignes.length; });
  if(!n) return corrige.map(function(c){ return c.lignes.map(function(){ return 0; }); });
  var base = Math.floor(20/n*2)/2, rest = rnd(20 - base*n), pts = [];
  var flat = []; for(var i=0;i<n;i++) flat.push(base);
  for(var j=0; rest>0.0001 && j<4*n; j++){ var idx = j % n; var add = Math.min(0.5, rest); flat[idx] = rnd(flat[idx]+add); rest = rnd(rest-add); }
  var k = 0;
  return corrige.map(function(c){ return c.lignes.map(function(){ return flat[k++]; }); });
}
function blocksCorrige(doc){
  var pts = bareme(doc.corrige||[]);
  var out = [];
  (doc.corrige||[]).forEach(function(c,i){
    out.push('<div class="ep-co ep-item"><div class="ep-itemt">'+esc(c.item||('Item '+(i+1)))+'</div><table><tr><th style="width:42px">N°</th><th>Réponse attendue</th><th style="width:60px">Barème</th></tr>'
      + c.lignes.map(function(l,k){ return '<tr><td>'+String.fromCharCode(65+k)+'</td><td>'+esc(stripLetter(l))+'</td><td style="text-align:center">'+fr(pts[i][k])+'</td></tr>'; }).join('')
      + '</table></div>');
  });
  out.push('<div class="ep-note" style="font-weight:700;color:#0b1f3f">Total : 20 points.</div>');
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
function groups(){
  var tp = T(S.type); if(!tp) return [];
  var list = (typeof resumesCache !== 'undefined' && resumesCache ? resumesCache : []).filter(function(r){
    return r.classe === S.classe && tp.mat.test(normUp(r.matiere));
  });
  try{ if(typeof compareResumes === 'function') list.sort(compareResumes); }catch(e){}
  var mats = {}; list.forEach(function(r){ mats[r.matiere] = 1; });
  var multi = Object.keys(mats).length > 1;
  var map = {}, order = [];
  list.forEach(function(r){
    var p = []; addPart(p,'Unité',r.unite); addPart(p,'Dossier',r.dossier); addPart(p,'SA',r.sa);
    var key = (multi ? r.matiere+' · ' : '') + (p.join(' · ') || 'Sans SA');
    if(!map[key]){ map[key] = { key:key, items:[] }; order.push(key); }
    map[key].items.push(r);
  });
  return order.map(function(k){ return map[k]; });
}
function selectedResumes(){
  var gs = groups().filter(function(g){ return S.sel[g.key]; });
  var out = [], i = 0, more = true;
  while(more && out.length < 14){
    more = false;
    for(var k=0;k<gs.length && out.length<14;k++){ if(gs[k].items[i]){ out.push(gs[k].items[i]); more = true; } }
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
      + '<h3>'+esc(t.label)+'</h3><p style="font-size:11.5px;color:var(--ink-soft)">Durée : '+esc(t.duree)+'</p></div>';
  }).join('');
  return '<div class="masthead" style="border-bottom:none;margin-bottom:12px"><div><span class="eyebrow">Épreuves</span><h1>Épreuves d\u2019<em>intégration</em></h1></div></div>'
    + '<p class="ep-note">Choisis la classe et la matière : l\u2019appli compose toute l\u2019épreuve avec son corrigé, à partir des SA que tes élèves ont déjà étudiées.</p>'
    + '<span class="ep-lbl" style="font-size:12px;font-weight:700;color:var(--ink-soft)">Classe</span><div class="ep-chips">'+chips+'</div>'
    + '<div class="grid grid-2">'+cards+'</div>';
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
    list = '<div style="display:flex;gap:8px;margin:6px 0 8px"><button class="upto" style="flex:1;padding:8px;border:1.5px solid var(--line);border-radius:10px;background:#fff;font-weight:700;color:var(--blue);font-size:12.5px" onclick="EPH.all(true)">Tout cocher</button>'
      + '<button style="flex:1;padding:8px;border:1.5px solid var(--line);border-radius:10px;background:#fff;font-weight:700;color:var(--ink-soft);font-size:12.5px" onclick="EPH.all(false)">Tout décocher</button></div>'
      + '<p class="ep-note">'+nSel+' sur '+gs.length+' SA cochée'+(nSel>1?'s':'')+'. Astuce : « jusqu\u2019ici » coche tout ce qui précède.</p>'
      + gs.map(function(g,i){
          var on = !!S.sel[g.key];
          return '<div class="ep-row'+(on?' on':'')+'" onclick="EPH.toggle('+i+')"><span class="ck">'+(on?'✓':'')+'</span>'
            + '<span class="tt">'+esc(g.key)+'<small>'+g.items.length+' leçon'+(g.items.length>1?'s':'')+'</small></span>'
            + '<button type="button" class="upto" onclick="event.stopPropagation();EPH.upto('+i+')">jusqu\u2019ici</button></div>';
        }).join('');
  }
  var hint = S.type==='maths' ? '<p class="ep-note">Les calculs sont choisis selon tes SA parmi : statistiques, proportionnalité, aires, périmètres, volumes, fractions, décimaux, mesures, durées, opérations.</p>' : '';
  var need = !selectedResumes().length && !S.notions.trim();
  return '<button class="backbtn" onclick="EPH.back()">← Retour</button>'
    + '<div class="masthead" style="border-bottom:none;margin-bottom:8px"><div><span class="eyebrow">Épreuves — '+esc(S.classe)+'</span><h1>'+esc(tp.label)+'</h1></div></div>'
    + '<div class="ep-cfg">'
    + '<span class="ep-lbl">1. Où en êtes-tu dans la matière ?</span>'+list+hint
    + '<span class="ep-lbl">Autres leçons à couvrir (facultatif, une par ligne)</span><textarea oninput="EPH.notions(this.value)" placeholder="Ex. Les fractions décimales">'+esc(S.notions)+'</textarea>'
    + '<span class="ep-lbl">2. En-tête de l\u2019épreuve</span>'
    + '<input type="text" placeholder="École (ex. EPP Zogbodomey)" value="'+esc(S.ecole)+'" oninput="EPH.f(\'ecole\',this.value)">'
    + '<div style="height:8px"></div><input type="text" placeholder="Circonscription scolaire (ex. Zogbodomey)" value="'+esc(S.circ)+'" oninput="EPH.f(\'circ\',this.value)">'
    + '<div style="height:8px"></div><div style="display:flex;gap:8px"><input type="text" placeholder="Année scolaire" value="'+esc(S.annee)+'" oninput="EPH.f(\'annee\',this.value)"><input type="text" placeholder="Mois" value="'+esc(S.mois)+'" oninput="EPH.f(\'mois\',this.value)"></div>'
    + (S.err ? '<div class="ep-err">'+esc(S.err)+'</div>' : '')
    + '<button class="ep-btn" id="epGo" '+(need?'disabled':'')+' onclick="EPH.generate()">Générer l\u2019épreuve</button>'
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
    + '<button class="ep-btn alt" onclick="EPH.pdf(true)">Télécharger le corrigé et le barème (PDF)</button>'
    + '<button class="ep-btn alt" onclick="EPH.generate()">Générer une autre épreuve</button>'
    + '<div style="height:12px"></div>'
    + '<span class="ep-note" style="font-weight:700">Aperçu de l\u2019épreuve</span>' + pv(S.pages,'ep')
    + '<span class="ep-note" style="font-weight:700">Aperçu du corrigé</span>' + pv(S.pagesCo,'co');
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
    + ' ' + groups().filter(function(g){ return S.sel[g.key]; }).map(function(g){ return g.key; }).join(' ');
}

function buildPages(doc){
  var ent = { ecole:S.ecole.trim(), circ:S.circ.trim(), annee:S.annee.trim(), mois:S.mois.trim() };
  S.doc = doc;
  S.pages = paginate(doc, ent, 'ep');
  S.pagesCo = paginate(doc, ent, 'co');
}

var EPH = window.EPH = {
  classe: function(c){ if(!CLASSES_OK[c]) return; S.classe = c; S.sel = {}; render(); },
  type: function(k){ S.type = k; S.sel = {}; S.notions = ''; S.err = ''; S.step = 'config'; render(); window.scrollTo(0,0); },
  back: function(){ S.step = 'type'; render(); },
  edit: function(){ S.step = 'config'; render(); },
  toggle: function(i){ var g = groups()[i]; if(!g) return; S.sel[g.key] = !S.sel[g.key]; render(); },
  all: function(v){ groups().forEach(function(g){ S.sel[g.key] = v; }); render(); },
  upto: function(i){ groups().forEach(function(g,k){ S.sel[g.key] = k<=i; }); render(); },
  notions: function(v){ S.notions = v; var b = document.getElementById('epGo'); if(b) b.disabled = !selectedResumes().length && !v.trim(); },
  f: function(k,v){ S[k] = v; saveEntete(); },
  generate: async function(){
    var tp = T(S.type); saveEntete();
    S.seed = (Date.now() % 90000) + 7; S.err = ''; S.step = 'wait'; render(); window.scrollTo(0,0);
    try{
      var doc;
      if(S.type==='maths'){
        await new Promise(function(r){ setTimeout(r,50); });
        doc = mathsDoc(resumesText(), S.seed, S.classe);
      } else {
        var ctrl = (typeof AbortController!=='undefined') ? new AbortController() : null;
        var to = setTimeout(function(){ if(ctrl) ctrl.abort(); }, 85000);
        var body = {
          type: S.type, classe: S.classe, mois: S.mois, seed: S.seed, notions: S.notions.trim(),
          resumes: selectedResumes().map(function(r){ return { titre:r.titre, texte:plainText(r.texte).slice(0,380) }; })
        };
        var res = await fetch('/api/generate-epreuve', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(body), signal: ctrl ? ctrl.signal : undefined });
        clearTimeout(to);
        var data = await res.json().catch(function(){ return null; });
        if(!data || !data.ok) throw new Error(data && data.reason==='no-content' ? 'Coche au moins une SA ou écris une leçon à couvrir.' : 'L\u2019IA est occupée. Réessaie dans un instant.');
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
        await waitForImages(root);
        var el = root.firstElementChild;
        var opt = { margin:0, image:{ type:'jpeg', quality:0.95 },
          html2canvas:{ scale:2.2, useCORS:true, backgroundColor:'#ffffff', scrollX:0, scrollY:0, windowWidth:PAGE_W },
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

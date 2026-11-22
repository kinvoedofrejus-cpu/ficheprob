/* Regroupement de Fiches Prêtes (novembre 2026)
   « Je choisis quelques TITRES parmi les fiches prêtes → un seul PDF. »

   Principe : chaque matière a déjà son PDF de base + un .meta.json (pageStarts = page de début de chaque fiche,
   parSlots = repère du champ « Par : »). On n'a donc rien à régénérer : on COPIE les pages des fiches choisies dans
   un nouveau PDF, on recalcule pageStarts / parSlots pour ce nouveau PDF, puis l'appelant applique le nom + le
   filigrane avec stampReadyFichePdf (index.html), exactement comme pour une fiche normale.

   Les TITRES ne sont pas dans le meta : ils sont lus dans le texte de la 1re page de chaque fiche (pdf.js) par
   l'admin (admin-regrouper-fiches.html, bouton « Indexer les titres »), corrigeables à la main, puis rangés dans R2 :
   readyfiche-pdfs/{classe}/{matiere}.titles.json  (servi à tout le monde par /api/get-readyfiche-titles).

   Dépendances : PDFLib (pdf-lib) pour la fusion ; pdf.js n'est chargé qu'à la demande (indexation des titres). */
(function(global){
  'use strict';

  var PDFJS_VER = '3.11.174';
  var PDFJS_URL = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/' + PDFJS_VER + '/pdf.min.js';
  var PDFJS_WORKER = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/' + PDFJS_VER + '/pdf.worker.min.js';
  var pdfjsPromise = null;

  function loadScript(src){
    return new Promise(function(resolve, reject){
      var s = document.createElement('script');
      s.src = src; s.onload = function(){ resolve(); };
      s.onerror = function(){ reject(new Error('Chargement impossible : ' + src)); };
      document.head.appendChild(s);
    });
  }
  function loadPdfJs(){
    if(global.pdfjsLib){ global.pdfjsLib.GlobalWorkerOptions.workerSrc = PDFJS_WORKER; return Promise.resolve(global.pdfjsLib); }
    if(pdfjsPromise) return pdfjsPromise;
    pdfjsPromise = loadScript(PDFJS_URL).then(function(){
      global.pdfjsLib.GlobalWorkerOptions.workerSrc = PDFJS_WORKER;
      return global.pdfjsLib;
    }).catch(function(e){ pdfjsPromise = null; throw e; });
    return pdfjsPromise;
  }

  /* ---------- 1) Lecture des titres dans le texte du PDF ---------- */
  var LABEL = /^(TITRE|TH[ÈE]ME)\s*:?\s+(.+)$/i;
  var STOP = /^(Compétence|Competence|Connaissances|Stratégie|Strategie|Matériel|Materiel|D[ÉE]ROULEMENT|I\.|1-|Dur[ée]e|Capacité|Habiletés|Par\s*:|Cours|FICHE|SA N|S[ÉE]ANCE|UNIT[ÉE]|DOSSIER|Page\s*\d|RAPPEL|CONSIGNES)/i;

  function rowsOf(items){
    var its = items.filter(function(it){ return it && typeof it.str === 'string' && it.str.trim(); })
      .map(function(it){ return { s: it.str, x: it.transform[4], y: it.transform[5] }; });
    its.sort(function(a, b){ return (b.y - a.y) || (a.x - b.x); });
    var rows = [];
    its.forEach(function(it){
      var r = rows[rows.length - 1];
      if(r && Math.abs(r.y - it.y) <= 2.5) r.items.push(it);
      else rows.push({ y: it.y, items: [it] });
    });
    return rows.map(function(r){
      r.items.sort(function(a, b){ return a.x - b.x; });
      return r.items.map(function(i){ return i.s; }).join(' ').replace(/\s+/g, ' ').trim();
    }).filter(Boolean);
  }


  /* Cartouche d'en-tête : « DOSSIER / UNITÉ » et « SA N° » sont des CASES d'un tableau (libellé en haut, valeur dessous).
     1) lecture par POSITION (valeur sous le libellé) ; 2) à défaut, lecture par ORDRE (libellés puis valeurs dans le même ordre,
     ou libellé suivi de sa valeur). Ce qui n'est pas trouvé reste vide : l'admin peut le corriger dans admin-regrouper-fiches.html. */
  var LAB = /^(FICHE\s*N°?|COURS|DOSSIER|UNIT[ÉE]|SA\s*N°?|S[ÉE]ANCE\s*N°?|DUR[ÉE]E)\s*:?$/i;
  function kindOf(label){
    if(/^DOSSIER/i.test(label)) return 'd';
    if(/^UNIT/i.test(label)) return 'u';
    if(/^SA/i.test(label)) return 'a';
    return '';
  }
  function headerFields(items){
    var its = items.filter(function(it){ return it && typeof it.str === 'string' && it.str.trim(); })
      .map(function(it){ return { s: it.str.trim(), x: it.transform[4], y: it.transform[5], w: it.width || (it.str.length * 5) }; });
    var out = { d: '', dk: '', a: '' };
    function put(kind, value){
      var m = /^\s*(\d{1,3})\s*\.?\s*$/.exec(value || ''), v = m ? m[1] : '';   // un numéro seul (« 4 », « 1. ») : jamais « 45 min »
      if(kind === 'a'){ if(!out.a) out.a = v; }
      else if(kind === 'd' || kind === 'u'){ if(!out.dk){ out.dk = kind === 'd' ? 'Dossier' : 'Unité'; out.d = v; } else if(!out.d && out.dk === (kind === 'd' ? 'Dossier' : 'Unité')) out.d = v; }
    }
    // 1) position
    function valueBelow(L){
      var best = null;
      its.forEach(function(v){
        if(v === L) return;
        var dy = L.y - v.y;
        if(dy < 2 || dy > 32) return;
        var cx = v.x + v.w / 2;
        if(cx < L.x - 12 || cx > L.x + L.w + 12) return;
        if(LAB.test(v.s) || /^(TH[ÈE]ME|TITRE)/i.test(v.s) || v.s.length > 14) return;
        if(!best || dy < best.dy) best = { dy: dy, s: v.s };
      });
      return best ? best.s : '';
    }
    its.slice(0, 60).forEach(function(L){ var k = kindOf(L.s); if(k && LAB.test(L.s)) put(k, valueBelow(L)); });
    // 2) ordre
    if(!out.a || !out.d){
      var seq = its.slice(0, 60).map(function(x){ return x.s; });
      for(var k = 0; k < seq.length; k++){
        if(!LAB.test(seq[k])) continue;
        var k2 = k; while(k2 + 1 < seq.length && LAB.test(seq[k2 + 1])) k2++;
        var n = k2 - k + 1;
        if(n === 1){
          if(k + 1 < seq.length && !LAB.test(seq[k + 1]) && seq[k + 1].length <= 14) put(kindOf(seq[k]), seq[k + 1]);
        } else {
          var vals = seq.slice(k2 + 1, k2 + 1 + n);
          if(vals.length === n && !vals.some(function(v){ return LAB.test(v); })){
            for(var j = 0; j < n; j++) put(kindOf(seq[k + j]), vals[j]);
          } else if(n >= 2 && k + 1 < seq.length && !LAB.test(seq[k + 1])) { /* ambigu : on ne devine pas */ }
        }
        k = k2;
      }
      // libellé suivi directement de sa valeur (cases intercalées : « FICHE N° | 1 | COURS | CM2 | DOSSIER | 1 »)
      for(var q = 0; q + 1 < seq.length && q < 40; q++){
        var kk = kindOf(seq[q]);
        if(kk && LAB.test(seq[q]) && !LAB.test(seq[q + 1]) && seq[q + 1].length <= 14) put(kk, seq[q + 1]);
      }
    }
    return out;
  }

  function pickTitle(rows, i){
    var titre = '', theme = '', fn = '';
    var m, j, k;
    for(j = 0; j < Math.min(rows.length, 45); j++){
      var row = rows[j];
      if(!fn){ m = /FICHE\s*N°\s*(\d+)/i.exec(row); if(m) fn = m[1]; }
      m = LABEL.exec(row);
      if(!m) continue;
      var isTitre = /^TITRE/i.test(m[1]);
      if((isTitre && titre) || (!isTitre && theme)) continue;
      var val = m[2].trim();
      for(k = j + 1; k < Math.min(rows.length, j + 3); k++){
        var nx = rows[k];
        if(STOP.test(nx) || LABEL.test(nx) || nx.indexOf(':') >= 0 || nx.length > 70 || val.length > 110) break;
        val += ' ' + nx;
      }
      if(isTitre) titre = val; else theme = val;
    }
    var sub = '';
    for(j = 0; j < Math.min(rows.length, 4); j++){
      if(/^Page\s*\d/i.test(rows[j]) || /^Par\s*:?$/i.test(rows[j])) continue;
      sub = rows[j].length <= 90 ? rows[j] : rows[j].slice(0, 90);
      break;
    }
    var t = titre || theme || ('Fiche ' + (i + 1));
    var th = (titre && theme && theme !== titre) ? theme : '';
    return { t: t.slice(0, 160), th: th.slice(0, 120), s: sub, n: fn };
  }

  /* pdfBytes : ArrayBuffer du PDF de la matière ; meta : son .meta.json. Renvoie un tableau aligné sur meta.pageStarts. */
  async function extractTitles(pdfBytes, meta, onProgress){
    var pdfjs = await loadPdfJs();
    var doc = await pdfjs.getDocument({ data: new Uint8Array(pdfBytes.slice(0)) }).promise;
    var starts = meta.pageStarts || [];
    var out = [];
    for(var i = 0; i < starts.length; i++){
      var pageNo = starts[i] + 1;                       // pageStarts : base 0 ; pdf.js : base 1
      var end = i + 1 < starts.length ? starts[i + 1] : doc.numPages;
      var tx = await (await doc.getPage(pageNo)).getTextContent();
      var rec = pickTitle(rowsOf(tx.items), i);
      var hf = headerFields(tx.items);
      rec.d = hf.d; rec.dk = hf.dk; rec.a = hf.a;
      rec.p = Math.max(1, end - starts[i]);
      out.push(rec);
      if(onProgress) onProgress(i + 1, starts.length);
    }
    try{ doc.destroy(); }catch(e){}
    return out;
  }

  function titlesDoc(titles){
    return { v: 1, count: titles.length, at: Date.now(), titles: titles.map(function(x){
      return { t: String(x.t || '').slice(0, 160), th: String(x.th || '').slice(0, 120), s: String(x.s || '').slice(0, 90), n: String(x.n || ''), p: x.p | 0,
        d: String(x.d || '').slice(0, 6), dk: x.dk === 'Unité' ? 'Unité' : (x.dk ? 'Dossier' : ''), a: String(x.a || '').slice(0, 6) };
    }) };
  }

  async function fetchTitles(apiBase, classe, matiere){
    var res = await fetch((apiBase || '') + '/api/get-readyfiche-titles', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ classe: classe, matiere: matiere })
    });
    var data = await res.json().catch(function(){ return null; });
    if(!data || !data.ok || !data.doc || !Array.isArray(data.doc.titles)) return null;
    return data.doc;
  }

  /* ---------- 2) Fusion : copie des pages des fiches choisies ---------- */
  /* sources : [{ bytes:ArrayBuffer, meta, indices:[n° de fiche (base 0) dans l'ordre voulu] }]
     Renvoie { bytes, meta } — meta décrit le NOUVEAU PDF (pageStarts, parSlots recalculés), prêt pour stampReadyFichePdf. */
  async function buildSelection(sources, onProgress){
    var PDFDocument = global.PDFLib.PDFDocument;
    var out = await PDFDocument.create();
    var newMeta = { pageStarts: [], parSlots: [], pxToPt: 1, marginTopPt: 0, marginLeftPt: 0 };
    var done = 0, totalFiches = sources.reduce(function(n, s){ return n + s.indices.length; }, 0);

    for(var si = 0; si < sources.length; si++){
      var src = sources[si], meta = src.meta || {}, starts = meta.pageStarts || [];
      var doc = await PDFDocument.load(src.bytes, { ignoreEncryption: true });
      var total = doc.getPageCount();
      if(!starts.length) throw new Error('Repères de pages (meta) introuvables pour cette matière.');

      // Repères « Par : » : parSlots, sinon dérivés de parSlot (même formule que stampReadyFichePdf).
      var slots = Array.isArray(meta.parSlots) ? meta.parSlots.filter(function(sl){ return sl && sl.x1 != null; }) : [];
      if(!slots.length && meta.parSlot){
        var ps = meta.parSlot, k = meta.pxToPt || 1;
        slots = starts.map(function(pg){ return { page: pg, x1: (ps.x + ps.width) * k + (meta.marginLeftPt || 0), top: ps.y * k + (meta.marginTopPt || 0), bottom: (ps.y + ps.height) * k + (meta.marginTopPt || 0) }; });
      }

      var pageList = [], ranges = [];
      src.indices.forEach(function(idx){
        if(!(idx >= 0 && idx < starts.length)) throw new Error('Fiche n°' + (idx + 1) + ' hors de la matière (index des titres obsolète ?).');
        var a = starts[idx], b = idx + 1 < starts.length ? starts[idx + 1] : total;
        ranges.push({ a: a, b: b, first: pageList.length });
        for(var p = a; p < b && p < total; p++) pageList.push(p);
      });

      // UN SEUL copyPages par PDF source : les polices / images communes ne sont copiées qu'une fois.
      var copied = await out.copyPages(doc, pageList);
      var base = out.getPageCount();
      copied.forEach(function(pg){ out.addPage(pg); });
      ranges.forEach(function(r){
        newMeta.pageStarts.push(base + r.first);
        slots.forEach(function(sl){
          if(sl.page >= r.a && sl.page < r.b){
            var c = {}; for(var key in sl) c[key] = sl[key];
            c.page = base + r.first + (sl.page - r.a);
            newMeta.parSlots.push(c);
          }
        });
        done++;
        if(onProgress) onProgress(done, totalFiches);
      });
      if(si === 0 && meta.pageHeightPt) newMeta.pageHeightPt = meta.pageHeightPt;
    }
    newMeta.pageCount = out.getPageCount();
    var bytes = await out.save();
    return { bytes: bytes, meta: newMeta };
  }

  global.FPBRegroup = {
    loadPdfJs: loadPdfJs,
    extractTitles: extractTitles,
    titlesDoc: titlesDoc,
    fetchTitles: fetchTitles,
    buildSelection: buildSelection,
    _rowsOf: rowsOf, _pickTitle: pickTitle, _headerFields: headerFields     // exposés pour les tests
  };
})(typeof window !== 'undefined' ? window : globalThis);

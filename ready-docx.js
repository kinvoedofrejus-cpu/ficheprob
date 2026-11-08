/* =====================================================================
   FicheProBot — Word (.docx) des « Fiches Prêtes » (nouveau modèle, 29/10/2026)
   ---------------------------------------------------------------------
   Les Word de base (un par classe/matière, mis en page dans le nouveau modèle) sont
   déposés une fois pour toutes dans R2 (readyfiche-docx/{classe}/{matiere}.docx, voir
   admin-upload-readyfiche-word.html). Au téléchargement, ce script PERSONNALISE le fichier
   dans le navigateur, sans toucher à la mise en page :
     - « Par : FicheProBot » -> « Par : <nom de l'enseignant> » sur chaque fiche ;
     - « Fiche élaborée le … » -> date du jour ;
     - filigrane : nom répété sur toute la page (image pleine page verrouillée, placée dans
       l'en-tête de CHAQUE section, donc sur toutes les fiches).
   Un .docx est un ZIP : lecteur/écrivain ZIP minimal ci-dessous (inflate/deflate natifs du
   navigateur : DecompressionStream / CompressionStream), aucune bibliothèque externe.

   API :  window.FPBDocx.patch(arrayBuffer, { teacherName, dateText }) -> Promise<Blob>
   ===================================================================== */
(function(){
  'use strict';

  var MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

  /* ---------- ZIP : CRC32 ---------- */
  var CRC_TABLE = null;
  function crc32(bytes){
    if(!CRC_TABLE){
      CRC_TABLE = new Uint32Array(256);
      for(var n = 0; n < 256; n++){
        var c = n;
        for(var k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
        CRC_TABLE[n] = c >>> 0;
      }
    }
    var crc = 0xFFFFFFFF;
    for(var i = 0; i < bytes.length; i++) crc = CRC_TABLE[(crc ^ bytes[i]) & 0xFF] ^ (crc >>> 8);
    return (crc ^ 0xFFFFFFFF) >>> 0;
  }

  async function streamThrough(bytes, transform){
    var stream = new Blob([bytes]).stream().pipeThrough(transform);
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }
  async function deflateRaw(bytes){
    if(typeof CompressionStream === 'undefined') return null;
    try{ return await streamThrough(bytes, new CompressionStream('deflate-raw')); }catch(e){ return null; }
  }
  async function inflateRaw(bytes){
    if(typeof DecompressionStream === 'undefined') throw new Error('Ce navigateur ne peut pas ouvrir le fichier Word (mise à jour du navigateur nécessaire).');
    return await streamThrough(bytes, new DecompressionStream('deflate-raw'));
  }

  /* ---------- ZIP : lecture ---------- */
  async function readZip(buf){
    var u8 = new Uint8Array(buf), dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
    var eocd = -1;
    for(var i = u8.length - 22; i >= Math.max(0, u8.length - 65557); i--){
      if(dv.getUint32(i, true) === 0x06054b50){ eocd = i; break; }
    }
    if(eocd < 0) throw new Error('Fichier Word illisible (archive invalide).');
    var count = dv.getUint16(eocd + 10, true), cdOff = dv.getUint32(eocd + 16, true);
    var dec = new TextDecoder(), files = [], p = cdOff;
    for(var n = 0; n < count; n++){
      if(dv.getUint32(p, true) !== 0x02014b50) throw new Error('Fichier Word illisible (répertoire invalide).');
      var flags = dv.getUint16(p + 8, true), method = dv.getUint16(p + 10, true);
      var csize = dv.getUint32(p + 20, true), nlen = dv.getUint16(p + 28, true), elen = dv.getUint16(p + 30, true), clen = dv.getUint16(p + 32, true);
      var lho = dv.getUint32(p + 42, true);
      var name = dec.decode(u8.subarray(p + 46, p + 46 + nlen));
      var lnlen = dv.getUint16(lho + 26, true), lelen = dv.getUint16(lho + 28, true);
      var start = lho + 30 + lnlen + lelen;
      files.push({ name: name, method: method, data: u8.subarray(start, start + csize), isDir: name.charAt(name.length - 1) === '/' });
      p += 46 + nlen + elen + clen;
    }
    return files;
  }
  async function fileBytes(f){
    if(f.method === 0) return f.data;
    if(f.method === 8) return await inflateRaw(f.data);
    throw new Error('Compression du fichier Word non prise en charge.');
  }

  /* ---------- ZIP : écriture ---------- */
  async function makeZip(files){   // files : [{ name, data:Uint8Array }]
    var enc = new TextEncoder();
    var parts = [], central = [], offset = 0;
    var now = new Date();
    var dosTime = ((now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1)) & 0xFFFF;
    var dosDate = (((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate()) & 0xFFFF;
    for(var i = 0; i < files.length; i++){
      var f = files[i];
      var nameBytes = enc.encode(f.name);
      var raw = f.data;
      var crc = crc32(raw);
      var comp = await deflateRaw(raw);
      var method = 8;
      if(!comp || comp.length >= raw.length){ comp = raw; method = 0; }
      var lh = new DataView(new ArrayBuffer(30));
      lh.setUint32(0, 0x04034b50, true); lh.setUint16(4, 20, true); lh.setUint16(6, 0x0800, true);
      lh.setUint16(8, method, true); lh.setUint16(10, dosTime, true); lh.setUint16(12, dosDate, true);
      lh.setUint32(14, crc, true); lh.setUint32(18, comp.length, true); lh.setUint32(22, raw.length, true);
      lh.setUint16(26, nameBytes.length, true); lh.setUint16(28, 0, true);
      parts.push(new Uint8Array(lh.buffer), nameBytes, comp);
      var ch = new DataView(new ArrayBuffer(46));
      ch.setUint32(0, 0x02014b50, true); ch.setUint16(4, 20, true); ch.setUint16(6, 20, true);
      ch.setUint16(8, 0x0800, true); ch.setUint16(10, method, true); ch.setUint16(12, dosTime, true);
      ch.setUint16(14, dosDate, true); ch.setUint32(16, crc, true); ch.setUint32(20, comp.length, true);
      ch.setUint32(24, raw.length, true); ch.setUint16(28, nameBytes.length, true);
      ch.setUint32(42, offset, true);
      central.push(new Uint8Array(ch.buffer), nameBytes);
      offset += 30 + nameBytes.length + comp.length;
    }
    var cdSize = 0;
    central.forEach(function(c){ cdSize += c.length; });
    var end = new DataView(new ArrayBuffer(22));
    end.setUint32(0, 0x06054b50, true); end.setUint16(8, files.length, true); end.setUint16(10, files.length, true);
    end.setUint32(12, cdSize, true); end.setUint32(16, offset, true);
    return new Blob(parts.concat(central, [new Uint8Array(end.buffer)]), { type: MIME });
  }

  /* ---------- XML ---------- */
  function esc(s){
    return String(s == null ? '' : s)
      .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '')
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function escRepl(s){ return s.replace(/\$/g, '$$$$'); }   // protège « $ » dans String.replace

  /* ---------- Filigrane : image PNG pleine page (même grille que le PDF) ---------- */
  var WM_W_PT = 595.28, WM_H_PT = 841.89, EMU_PT = 12700;
  async function watermarkPng(name){
    try{
      if(typeof document === 'undefined') return null;
      var S = 2;                                       // 2 px par point : net à l'impression, fichier léger
      var cv = document.createElement('canvas');
      cv.width = Math.round(WM_W_PT * S); cv.height = Math.round(WM_H_PT * S);
      var ctx = cv.getContext('2d');
      if(!ctx) return null;
      ctx.font = 'bold ' + (15 * S) + 'px Arial, Helvetica, sans-serif';
      ctx.fillStyle = '#000'; ctx.globalAlpha = 0.08; ctx.textBaseline = 'alphabetic';
      var tw = ctx.measureText(name).width;
      var stepX = tw + 60 * S, stepY = 70 * S, W = cv.width, H = cv.height;
      for(var y = -H * 0.3; y < H * 1.3; y += stepY){
        for(var x = -W * 0.3; x < W * 1.3; x += stepX){
          ctx.save(); ctx.translate(x, y); ctx.rotate(28 * Math.PI / 180); ctx.fillText(name, 0, 0); ctx.restore();
        }
      }
      var blob = await new Promise(function(res){ cv.toBlob(res, 'image/png'); });
      if(!blob) return null;
      return new Uint8Array(await blob.arrayBuffer());
    }catch(e){ return null; }
  }
  var HDR_NS = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" ' +
    'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" ' +
    'xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" ' +
    'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" ' +
    'xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"';
  var WM_DOC_ID = 9100;
  function wmAnchorParagraph(){
    var cx = Math.round(WM_W_PT * EMU_PT), cy = Math.round(WM_H_PT * EMU_PT), id = ++WM_DOC_ID;
    // Paragraphe d'ancrage minuscule (1 pt, interligne exact) : ne décale jamais le haut de page.
    return '<w:p><w:pPr><w:spacing w:before="0" w:after="0" w:line="20" w:lineRule="exact"/></w:pPr><w:r><w:rPr><w:noProof/><w:sz w:val="2"/><w:szCs w:val="2"/></w:rPr><w:drawing>' +
      '<wp:anchor distT="0" distB="0" distL="0" distR="0" simplePos="0" relativeHeight="0" behindDoc="1" locked="1" layoutInCell="1" allowOverlap="1">' +
      '<wp:simplePos x="0" y="0"/><wp:positionH relativeFrom="page"><wp:posOffset>0</wp:posOffset></wp:positionH>' +
      '<wp:positionV relativeFrom="page"><wp:posOffset>0</wp:posOffset></wp:positionV>' +
      '<wp:extent cx="' + cx + '" cy="' + cy + '"/><wp:effectExtent l="0" t="0" r="0" b="0"/><wp:wrapNone/>' +
      '<wp:docPr id="' + id + '" name="FiligraneFicheProBot' + id + '" descr=""/>' +
      '<wp:cNvGraphicFramePr><a:graphicFrameLocks noChangeAspect="1"/></wp:cNvGraphicFramePr>' +
      '<a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic>' +
      '<pic:nvPicPr><pic:cNvPr id="' + id + '" name="filigrane.png"/><pic:cNvPicPr><a:picLocks noChangeAspect="1" noSelect="1" noMove="1" noResize="1" noRot="1" noChangeArrowheads="1" noEditPoints="1" noAdjustHandles="1" noCrop="1"/></pic:cNvPicPr></pic:nvPicPr>' +
      '<pic:blipFill><a:blip r:embed="rIdFpbWm"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>' +
      '<pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="' + cx + '" cy="' + cy + '"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr>' +
      '</pic:pic></a:graphicData></a:graphic></wp:anchor></w:drawing></w:r></w:p>';
  }
  function headerXml(){
    return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:hdr ' + HDR_NS + '>' + wmAnchorParagraph() + '</w:hdr>';
  }
  var REL_IMG = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/image';
  var REL_NS_PKG = 'http://schemas.openxmlformats.org/package/2006/relationships';
  /* Table des relations d'un .rels : { Id: Target } */
  function parseRels(txt){
    var map = {}, re = /<Relationship\b[^>]*>/g, m;
    while((m = re.exec(txt || ''))){
      var id = /\bId\s*=\s*["']([^"']*)["']/.exec(m[0]), tg = /\bTarget\s*=\s*["']([^"']*)["']/.exec(m[0]);
      if(id && tg) map[id[1]] = tg[1];
    }
    return map;
  }
  /* Insère le paragraphe d'ancrage au début d'un en-tête existant (le logo / les textes de l'en-tête restent intacts). */
  function injectIntoHeader(xml){
    if(xml.indexOf('FiligraneFicheProBot') >= 0) return xml;
    var m = /<w:hdr\b[^>]*>/.exec(xml);
    if(!m){ return xml; }
    var open = m[0];
    // L'en-tête existant doit déclarer les espaces de noms utilisés par l'ancrage (wp, a, pic, r).
    var need = { w: 'http://schemas.openxmlformats.org/wordprocessingml/2006/main',
      r: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships',
      wp: 'http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing',
      a: 'http://schemas.openxmlformats.org/drawingml/2006/main',
      pic: 'http://schemas.openxmlformats.org/drawingml/2006/picture' };
    var add = '';
    Object.keys(need).forEach(function(k){ if(!new RegExp('xmlns:' + k + '="').test(open)) add += ' xmlns:' + k + '="' + need[k] + '"'; });
    var open2 = add ? open.replace(/>$/, add + '>') : open;
    if(/\/>$/.test(open)){ return xml.replace(open, open2.replace(/\/>$/, '>') + wmAnchorParagraph() + '</w:hdr>'); }
    return xml.replace(open, open2 + wmAnchorParagraph());
  }

  /* Remplace « FicheProBot » quand Word l'a coupé en plusieurs <w:t> dans un même paragraphe (ex. « Par : Fiche » + « ProBot »).
     Seuls les paragraphes qui contiennent « Par » + « FicheProBot » sont touchés ; le texte et la mise en forme restent ceux du 1er morceau. */
  function replaceSplitName(xml, nameEsc){
    return xml.replace(/<w:p[ >][\s\S]*?<\/w:p>/g, function(par){
      var tre = /(<w:t(?: [^>]*)?>)([^<]*)(<\/w:t>)/g, parts = [], m;
      while((m = tre.exec(par))) parts.push({ idx: m.index, len: m[0].length, open: m[1], text: m[2], close: m[3] });
      if(parts.length < 2) return par;
      var full = parts.map(function(p){ return p.text; }).join('');
      if(full.indexOf('FicheProBot') < 0 || !/Par\s*:/.test(full)) return par;
      var at = full.indexOf('FicheProBot'), end = at + 'FicheProBot'.length, pos = 0, texts = parts.map(function(p){ return p.text; });
      var firstDone = false;
      for(var i = 0; i < parts.length; i++){
        var a = pos, b = pos + texts[i].length; pos = b;
        if(b <= at || a >= end) continue;
        var cutA = Math.max(a, at) - a, cutB = Math.min(b, end) - a;
        texts[i] = texts[i].slice(0, cutA) + (firstDone ? '' : nameEsc) + texts[i].slice(cutB);
        firstDone = true;
      }
      var res = '', last = 0;
      parts.forEach(function(p, i){
        var open = p.open.indexOf('xml:space') < 0 ? p.open.replace(/>$/, ' xml:space="preserve">') : p.open;
        res += par.slice(last, p.idx) + open + texts[i] + p.close; last = p.idx + p.len;
      });
      return res + par.slice(last);
    });
  }

  /* ---------- Personnalisation ---------- */
  async function patch(arrayBuffer, opts){
    opts = opts || {};
    var name = (opts.teacherName || '').trim();
    var dateText = (opts.dateText || '').trim();
    var files = await readZip(arrayBuffer);
    var enc = new TextEncoder(), dec = new TextDecoder();
    var byName = {};
    files.forEach(function(f){ byName[f.name] = f; });
    if(!byName['word/document.xml']) throw new Error("Ce fichier n'est pas un document Word valide.");

    var wmPng = (name && opts.watermark !== false) ? await watermarkPng(name) : null;   // watermark:false -> nom à « Par : » seulement
    var hdrName = 'word/fpb-header-wm.xml';
    var DOC_RELS = 'word/_rels/document.xml.rels';

    /* --- Filigrane : plan des en-têtes (une section = une fiche) ---
       Chaque section reçoit le filigrane dans SES en-têtes (défaut, 1re page si « titlePg », pages paires si activé) :
       - en-tête déjà présent (logo, texte…) -> l'image est AJOUTÉE à cet en-tête (on ne l'écarte plus) ;
       - pas d'en-tête de ce type -> on référence notre en-tête dédié. */
    var docXml = dec.decode(await fileBytes(byName['word/document.xml']));
    var injectParts = {};            // 'word/headerN.xml' -> true (en-têtes existants à compléter)
    var needOwnHeader = false;
    if(wmPng){
      var relsTxt = byName[DOC_RELS] ? dec.decode(await fileBytes(byName[DOC_RELS])) : '';
      var relMap = parseRels(relsTxt);
      var evenOdd = false;
      if(byName['word/settings.xml']) evenOdd = /<w:evenAndOddHeaders\b(?![^>]*w:val="(?:0|false|off)")/.test(dec.decode(await fileBytes(byName['word/settings.xml'])));
      docXml = docXml.replace(/<w:sectPr(?=[\s>])([^>]*?)(\/?)>([\s\S]*?<\/w:sectPr>)?/g, function(all, attrs, selfClose, rest){
        if(selfClose) return all;                      // <w:sectPr/> vide : rien à compléter
        var inner = rest ? rest.slice(0, rest.length - '</w:sectPr>'.length) : '';
        var types = ['default'];
        if(/<w:titlePg\b(?![^>]*w:val="(?:0|false|off)")/.test(inner)) types.push('first');
        if(evenOdd) types.push('even');
        var have = {}, hre = /<w:headerReference\b[^>]*>/g, hm;
        while((hm = hre.exec(inner))){
          var ty = /w:type\s*=\s*["']([^"']*)["']/.exec(hm[0]), rid = /r:id\s*=\s*["']([^"']*)["']/.exec(hm[0]);
          if(!ty || !rid) continue;
          var tg = relMap[rid[1]];
          if(tg){
            have[ty[1]] = true;
            injectParts[tg.charAt(0) === '/' ? tg.slice(1) : 'word/' + tg.replace(/^\.\.?\//, '').replace(/^word\//, '')] = true;
          } else {
            // Référence vers un en-tête introuvable : on la retire, la section recevra notre en-tête (sinon aucune page n'est tamponnée).
            inner = inner.replace(hm[0], '');
          }
        }
        var add = '';
        types.forEach(function(t){ if(!have[t]){ add += '<w:headerReference w:type="' + t + '" r:id="rIdFpbHdr"/>'; needOwnHeader = true; } });
        return '<w:sectPr' + attrs + '>' + add + inner + '</w:sectPr>';
      });
      if(!/<w:sectPr[\s>]/.test(docXml) && /<\/w:body>/.test(docXml)){
        docXml = docXml.replace('</w:body>', '<w:sectPr><w:headerReference w:type="default" r:id="rIdFpbHdr"/></w:sectPr></w:body>');
        needOwnHeader = true;
      }
      // Les cellules / paragraphes à fond « blanc » cachent le filigrane (Word dessine l'en-tête DERRIÈRE le texte) : fond blanc -> aucun fond.
      // Visuellement identique sur une page blanche, mais le filigrane apparaît alors sur TOUTES les pages (tableaux des fiches compris).
      docXml = docXml.replace(/(<w:shd\b[^>]*?w:fill\s*=\s*)(["'])(?:FFFFFF|ffffff|FFF|white)\2/g, '$1$2auto$2');
    }

    var out = [], relsDone = {};
    for(var i = 0; i < files.length; i++){
      var f = files[i];
      if(f.isDir) continue;
      var data = await fileBytes(f);
      if(f.name === 'word/document.xml'){
        var xml = docXml;
        if(name){
          // « Par : FicheProBot » (un seul texte) ou « Par : » + « FicheProBot » (deux textes) -> nom de l'enseignant
          xml = xml.replace(/Par : FicheProBot/g, escRepl('Par : ' + esc(name)));
          xml = xml.replace(/(<w:t(?: [^>]*)?>)FicheProBot(<\/w:t>)/g, '$1' + escRepl(esc(name)) + '$2');
          xml = replaceSplitName(xml, esc(name));   // « Par : FicheProBot » coupé en plusieurs morceaux par Word (fiches collées / retouchées)
        }
        if(opts.removeDate) xml = xml.replace(/Fiche élaborée le [^<]*/g, '');   // compte propriétaire : pas de date (comme le PDF)
        else if(dateText) xml = xml.replace(/(Fiche élaborée le )[^<]*/g, '$1' + escRepl(esc(dateText)));
        data = enc.encode(xml);
      } else if(wmPng && injectParts[f.name]){
        data = enc.encode(injectIntoHeader(dec.decode(data)));
      } else if(wmPng && /^word\/_rels\/(.+)\.rels$/.test(f.name) && injectParts['word/' + RegExp.$1]){
        var hrels = dec.decode(data);
        if(hrels.indexOf('rIdFpbWm') < 0) hrels = hrels.replace('</Relationships>', '<Relationship Id="rIdFpbWm" Type="' + REL_IMG + '" Target="media/fpb-filigrane.png"/></Relationships>');
        relsDone[f.name] = true;
        data = enc.encode(hrels);
      } else if(wmPng && f.name === DOC_RELS && needOwnHeader){
        var rels = dec.decode(data).replace('</Relationships>',
          '<Relationship Id="rIdFpbHdr" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/header" Target="fpb-header-wm.xml"/></Relationships>');
        data = enc.encode(rels);
      } else if(wmPng && f.name === '[Content_Types].xml'){
        var ct = dec.decode(data);
        if(!/Extension="png"/i.test(ct)) ct = ct.replace(/(<Types[^>]*>)/, '$1<Default Extension="png" ContentType="image/png"/>');
        if(needOwnHeader) ct = ct.replace('</Types>', '<Override PartName="/' + hdrName + '" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml"/></Types>');
        data = enc.encode(ct);
      }
      out.push({ name: f.name, data: data });
    }
    if(wmPng){
      // En-têtes existants sans fichier .rels : on le crée (il ne contenait aucune relation).
      Object.keys(injectParts).forEach(function(part){
        var rn = part.replace(/^word\//, 'word/_rels/') + '.rels';
        if(!relsDone[rn] && !byName[rn]){
          out.push({ name: rn, data: enc.encode('<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="' + REL_NS_PKG + '">' +
            '<Relationship Id="rIdFpbWm" Type="' + REL_IMG + '" Target="media/fpb-filigrane.png"/></Relationships>') });
        }
      });
      if(needOwnHeader){
        out.push({ name: hdrName, data: enc.encode(headerXml()) });
        out.push({ name: 'word/_rels/fpb-header-wm.xml.rels', data: enc.encode(
          '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="' + REL_NS_PKG + '">' +
          '<Relationship Id="rIdFpbWm" Type="' + REL_IMG + '" Target="media/fpb-filigrane.png"/></Relationships>') });
      }
      out.push({ name: 'word/media/fpb-filigrane.png', data: wmPng });
    }
    return await makeZip(out);
  }

  /* Reconnaissance d'un Word déposé (page admin) : classe (« COURS »), titre de la 1re fiche, nombre de fiches (= sections). */
  async function inspect(arrayBuffer){
    var files = await readZip(arrayBuffer);
    var doc = null;
    for(var i = 0; i < files.length; i++) if(files[i].name === 'word/document.xml') doc = files[i];
    if(!doc) throw new Error("Ce fichier n'est pas un document Word valide.");
    var xml = new TextDecoder().decode(await fileBytes(doc));
    var texts = [], re = /<w:t(?: [^>]*)?>([^<]*)<\/w:t>/g, m;
    while((m = re.exec(xml))) texts.push(m[1].replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'"));
    var tally = {};
    texts.forEach(function(t){ var v = t.trim(); if(/^(CI|CP|CE1|CE2|CM1|CM2)$/.test(v)) tally[v] = (tally[v] || 0) + 1; });
    var classe = null, best = 0;
    Object.keys(tally).forEach(function(k){ if(tally[k] > best){ best = tally[k]; classe = k; } });
    var title = [];
    for(var j = 0; j < texts.length && !/Fiche élaborée/.test(texts[j]) && title.length < 4; j++) title.push(texts[j].trim());
    var count = (xml.match(/<w:sectPr[ >]/g) || []).length;
    // Maternelle : pas de case « CI…CM2 » ; on reconnaît « DOMAINE 1 » … « DOMAINE 5 » (le plus fréquent dans le fichier)
    var dom = {}, domaine = null, dbest = 0;
    texts.forEach(function(t){ var mm = /DOMAINE\s*([1-5])\b/i.exec(t); if(mm) dom[mm[1]] = (dom[mm[1]] || 0) + 1; });
    Object.keys(dom).forEach(function(k){ if(dom[k] > dbest){ dbest = dom[k]; domaine = k; } });
    // Maternelle : le « DOMAINE n » domine (ou « MATERNELLE » est écrit) -> on ne se laisse pas tromper par une case de classe isolée
    var matCount = 0; texts.forEach(function(t){ if(/^\s*(?:ÉCOLE\s+)?MATERNELLE\s*$/i.test(t) || /^\s*(?:PS|MS|GS)\s*$/.test(t)) matCount++; });
    if(domaine && (!classe || dbest > best || matCount > best)) classe = 'MATERNELLE';
    else if(!classe && matCount) classe = 'MATERNELLE';
    return { classe: classe, domaine: domaine, title: title.join(' ').replace(/\s+/g, ' ').trim(), count: count };
  }

  /* Aperçu gratuit : ne garde que les n premières fiches (une fiche = une section) puis personnalise avec le libellé donné
     (nom/filigrane « APERÇU »). Retourne un Blob .docx. */
  async function preview(arrayBuffer, n, label){
    n = Math.max(1, n || 2);
    var files = await readZip(arrayBuffer);
    var enc = new TextEncoder(), dec = new TextDecoder(), out = [];
    for(var i = 0; i < files.length; i++){
      var f = files[i];
      if(f.isDir) continue;
      var data = await fileBytes(f);
      if(f.name === 'word/document.xml'){
        var xml = dec.decode(data), pos = -1, k = 0;
        while(k < n){ pos = xml.indexOf('<w:sectPr', pos + 1); if(pos < 0) break; k++; }
        var isLast = pos >= 0 && xml.indexOf('<w:sectPr', pos + 1) < 0;
        if(pos >= 0 && !isLast){
          var pStart = Math.max(xml.lastIndexOf('<w:p>', pos), xml.lastIndexOf('<w:p ', pos));
          var sect = xml.slice(pos, xml.indexOf('</w:sectPr>', pos) + 11);
          xml = xml.slice(0, pStart) + sect + '</w:body></w:document>';
        }
        data = enc.encode(xml);
      }
      out.push({ name: f.name, data: data });
    }
    var small = await (await makeZip(out)).arrayBuffer();
    return await patch(small, { teacherName: label || 'APERÇU', dateText: '' });
  }

  async function zip(entries){   // entries : [{ name, blob }] -> Blob .zip
    var files = [];
    for(var i = 0; i < entries.length; i++) files.push({ name: entries[i].name, data: new Uint8Array(await entries[i].blob.arrayBuffer()) });
    var b = await makeZip(files);
    return new Blob([b], { type: 'application/zip' });
  }

  window.FPBDocx = { patch: patch, inspect: inspect, preview: preview, zip: zip };
})();

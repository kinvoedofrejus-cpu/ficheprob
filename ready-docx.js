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
  function headerXml(){
    var cx = Math.round(WM_W_PT * EMU_PT), cy = Math.round(WM_H_PT * EMU_PT);
    // Paragraphe d'ancrage minuscule (1 pt, interligne exact) : ne décale jamais le haut de page.
    return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:hdr ' + HDR_NS + '>' +
      '<w:p><w:pPr><w:spacing w:before="0" w:after="0" w:line="20" w:lineRule="exact"/></w:pPr><w:r><w:rPr><w:noProof/><w:sz w:val="2"/><w:szCs w:val="2"/></w:rPr><w:drawing>' +
      '<wp:anchor distT="0" distB="0" distL="0" distR="0" simplePos="0" relativeHeight="0" behindDoc="1" locked="1" layoutInCell="1" allowOverlap="1">' +
      '<wp:simplePos x="0" y="0"/><wp:positionH relativeFrom="page"><wp:posOffset>0</wp:posOffset></wp:positionH>' +
      '<wp:positionV relativeFrom="page"><wp:posOffset>0</wp:posOffset></wp:positionV>' +
      '<wp:extent cx="' + cx + '" cy="' + cy + '"/><wp:effectExtent l="0" t="0" r="0" b="0"/><wp:wrapNone/>' +
      '<wp:docPr id="9101" name="FiligraneFicheProBot" descr=""/>' +
      '<wp:cNvGraphicFramePr><a:graphicFrameLocks noChangeAspect="1"/></wp:cNvGraphicFramePr>' +
      '<a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic>' +
      '<pic:nvPicPr><pic:cNvPr id="9102" name="filigrane.png"/><pic:cNvPicPr><a:picLocks noChangeAspect="1" noSelect="1" noMove="1" noResize="1" noRot="1" noChangeArrowheads="1" noEditPoints="1" noAdjustHandles="1" noCrop="1"/></pic:cNvPicPr></pic:nvPicPr>' +
      '<pic:blipFill><a:blip r:embed="rIdFpbWm"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>' +
      '<pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="' + cx + '" cy="' + cy + '"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr>' +
      '</pic:pic></a:graphicData></a:graphic></wp:anchor></w:drawing></w:r></w:p></w:hdr>';
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

    var out = [];
    var wmPng = name ? await watermarkPng(name) : null;
    var hdrName = 'word/fpb-header-wm.xml';

    for(var i = 0; i < files.length; i++){
      var f = files[i];
      if(f.isDir) continue;
      var data = await fileBytes(f);
      if(f.name === 'word/document.xml'){
        var xml = dec.decode(data);
        if(name){
          // « Par : FicheProBot » (un seul texte) ou « Par : » + « FicheProBot » (deux textes) -> nom de l'enseignant
          xml = xml.replace(/Par : FicheProBot/g, escRepl('Par : ' + esc(name)));
          xml = xml.replace(/(<w:t(?: [^>]*)?>)FicheProBot(<\/w:t>)/g, '$1' + escRepl(esc(name)) + '$2');
        }
        if(dateText) xml = xml.replace(/(Fiche élaborée le )[^<]*/g, '$1' + escRepl(esc(dateText)));
        if(wmPng){
          // Filigrane : référence d'en-tête ajoutée à CHAQUE section (une section = une fiche).
          xml = xml.replace(/<w:sectPr(?![^>]*\/>)([^>]*)>(?!<w:headerReference)/g, '<w:sectPr$1><w:headerReference w:type="default" r:id="rIdFpbHdr"/>');
        }
        data = enc.encode(xml);
      } else if(wmPng && f.name === 'word/_rels/document.xml.rels'){
        var rels = dec.decode(data).replace('</Relationships>',
          '<Relationship Id="rIdFpbHdr" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/header" Target="fpb-header-wm.xml"/></Relationships>');
        data = enc.encode(rels);
      } else if(wmPng && f.name === '[Content_Types].xml'){
        var ct = dec.decode(data);
        if(!/Extension="png"/i.test(ct)) ct = ct.replace(/(<Types[^>]*>)/, '$1<Default Extension="png" ContentType="image/png"/>');
        ct = ct.replace('</Types>', '<Override PartName="/' + hdrName + '" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml"/></Types>');
        data = enc.encode(ct);
      }
      out.push({ name: f.name, data: data });
    }
    if(wmPng){
      out.push({ name: hdrName, data: enc.encode(headerXml()) });
      out.push({ name: 'word/_rels/fpb-header-wm.xml.rels', data: enc.encode(
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        '<Relationship Id="rIdFpbWm" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/fpb-filigrane.png"/></Relationships>') });
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
    return { classe: classe, title: title.join(' ').replace(/\s+/g, ' ').trim(), count: count };
  }

  window.FPBDocx = { patch: patch, inspect: inspect };
})();

import puppeteer from '@cloudflare/puppeteer';
import { PDFDocument } from 'pdf-lib';
import { requireAdmin, json } from './_shared.js';

// Cloudflare Function — /api/admin-pregenerate-readyfiches
//
// Pré-génère UNE FOIS POUR TOUTES le PDF "de base" (sans nom d'enseignant,
// sans filigrane) d'UNE matière Fiche Prête, en utilisant le Browser
// Rendering de Cloudflare (binding BROWSER, voir wrangler.toml) pour ouvrir
// render-readyfiche.html?classe=...&matiere=... (page interne servie comme
// fichier statique du même projet). La mise en page de chaque fiche est
// faite par le moteur d'impression du navigateur (pagination native via
// <thead> répété), pas par html2canvas — un PDF texte net, rapide.
//
// On imprime UNE FICHE À LA FOIS (window.renderOneFiche(idx) + page.pdf()),
// puis on fusionne tous les PDF obtenus avec pdf-lib ICI, côté serveur — ce
// qui permet de connaître le nombre EXACT de pages consommées par chaque
// fiche, et donc la page de DÉBUT de chaque fiche dans le document fusionné
// (meta.pageStarts). C'est cette info qui permet au client de tamponner le
// nom de l'enseignant seulement sur la 1ère page de CHAQUE fiche (là où se
// trouve le bloc d'en-tête "Par :"), jamais sur les pages de continuation —
// voir stampReadyFichePdf() dans index.html.
//
// Résultat stocké dans R2 (FPB_IMAGES) :
//   readyfiche-pdfs/{classe}/{matiere}.pdf        <- le PDF fusionné
//   readyfiche-pdfs/{classe}/{matiere}.meta.json   <- { ficheCount, pageStarts, parSlot }
//
// Traite UNE SEULE matière par appel — admin-pregenerate-readyfiches.html
// boucle sur toutes les matières d'une classe, une par une, avec une barre
// de progression (nécessaire car une matière de 80+ fiches peut déjà
// approcher la limite de temps d'exécution d'un Worker).
export async function onRequestPost(context) {
  const { request, env } = context;
  let body;
  try { body = await request.json(); } catch { return json({ error: 'Requête invalide.' }, 400); }

  const { token, classe, matiere } = body || {};
  if (!(await requireAdmin(env, token))) return json({ error: 'Non autorisé' }, 401);
  if (!classe || !matiere) return json({ error: 'classe et matiere requis.' }, 400);
  if (!env.BROWSER) {
    return json({ error: "Le binding BROWSER (Browser Rendering Cloudflare) n'est pas configuré. Ajoute-le dans wrangler.toml (voir commentaire) et redéploie — nécessite le plan Workers Paid." }, 500);
  }

  const origin = new URL(request.url).origin;
  const renderUrl = `${origin}/render-readyfiche.html?classe=${encodeURIComponent(classe)}&matiere=${encodeURIComponent(matiere)}`;

  // Géométrie de render-readyfiche.html (@page A4, marges 15/10/14/10mm) —
  // le viewport Puppeteer est réglé sur la largeur imprimable EXACTE
  // (en px CSS) pour que les coordonnées mesurées via getBoundingClientRect()
  // (window.renderOneFiche) correspondent à la mise en page réellement
  // imprimée. Ces constantes sont aussi renvoyées dans meta.json pour que
  // le client (stampReadyFichePdf dans index.html) sache convertir ces px
  // CSS en points PDF sans dupliquer ces chiffres en dur côté client.
  const MM_TO_PT = 2.8346456693;
  const PX_PER_MM = 96 / 25.4;
  const PAGE_WIDTH_MM = 210, PAGE_HEIGHT_MM = 297;
  const MARGIN_TOP_MM = 15, MARGIN_LEFT_MM = 10;
  const CONTENT_WIDTH_PX = Math.round((PAGE_WIDTH_MM - 2 * MARGIN_LEFT_MM) * PX_PER_MM);

  let browser;
  try {
    browser = await puppeteer.launch(env.BROWSER);
    const page = await browser.newPage();
    await page.setViewport({ width: CONTENT_WIDTH_PX, height: 1600 });
    await page.goto(renderUrl, { waitUntil: 'networkidle0', timeout: 120000 });
    await page.waitForFunction('window.__READY_TO_INIT__ === true || window.__RENDER_ERROR__ === true', { timeout: 120000 });

    const renderError = await page.evaluate(() => window.__RENDER_ERROR__ === true);
    if (renderError) {
      await browser.close();
      return json({ error: `Matière introuvable dans ready-fiches-data.js : ${classe} / ${matiere}` }, 404);
    }

    const ficheCount = await page.evaluate(() => window.__FICHE_COUNT__);
    if (!ficheCount) {
      await browser.close();
      return json({ error: `Aucune fiche pour ${classe} / ${matiere}.` }, 404);
    }

    const mergedDoc = await PDFDocument.create();
    const pageStarts = [];
    let parSlot = null;

    for (let i = 0; i < ficheCount; i++) {
      const slot = await page.evaluate((idx) => window.renderOneFiche(idx), i);
      if (i === 0) parSlot = slot;
      const onePdfBytes = await page.pdf({ format: 'A4', printBackground: true });
      const srcDoc = await PDFDocument.load(onePdfBytes);
      pageStarts.push(mergedDoc.getPageCount());
      const copied = await mergedDoc.copyPages(srcDoc, srcDoc.getPageIndices());
      copied.forEach((p) => mergedDoc.addPage(p));
    }

    await browser.close();
    browser = null;

    const mergedBytes = await mergedDoc.save();

    const pdfKey = `readyfiche-pdfs/${classe}/${matiere}.pdf`;
    const metaKey = `readyfiche-pdfs/${classe}/${matiere}.meta.json`;
    await env.FPB_IMAGES.put(pdfKey, mergedBytes, { httpMetadata: { contentType: 'application/pdf' } });
    await env.FPB_IMAGES.put(metaKey, JSON.stringify({
      classe, matiere, ficheCount, pageStarts, parSlot,
      pxToPt: 0.75,
      pageWidthPt: PAGE_WIDTH_MM * MM_TO_PT,
      pageHeightPt: PAGE_HEIGHT_MM * MM_TO_PT,
      marginTopPt: MARGIN_TOP_MM * MM_TO_PT,
      marginLeftPt: MARGIN_LEFT_MM * MM_TO_PT,
      generatedAt: Date.now()
    }), { httpMetadata: { contentType: 'application/json' } });

    return json({ ok: true, classe, matiere, ficheCount, pageCount: mergedDoc.getPageCount(), pdfBytes: mergedBytes.byteLength });
  } catch (err) {
    if (browser) { try { await browser.close(); } catch {} }
    return json({ error: 'Erreur de pré-génération : ' + err.message }, 500);
  }
}

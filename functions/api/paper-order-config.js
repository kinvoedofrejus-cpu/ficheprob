import { json } from './_shared.js';
import { getPaperConfig, paperPagesFor, loadCatalogue, PAPER_MIN_PARTIAL, PAPER_PRINT_PER_PAGE, PAPER_REAM_PAGES, PAPER_REAM_PRICE } from './_paper.js';

/* Endpoint public — formule de prix (20 F/page + ram blanc/couleur par 500 pages) et nombre de pages de chaque matière,
   pour afficher au client le nombre de pages et le total de sa sélection. Le total réel est de toute façon recalculé à l'enregistrement. */
export async function onRequestGet(context) {
  try {
    const { env, request } = context;
    const cfg = await getPaperConfig(env.FPB_DB);
    const cat = await loadCatalogue(env, request);
    const pages = {};
    for (const classe of Object.keys(cat)) {
      for (const k of Object.keys(cat[classe])) {
        const r = await paperPagesFor(env, cfg, classe, k, Number(cat[classe][k].count) || 0);
        if (r.pages) pages[classe + '::' + k] = r.pages;
      }
    }
    return json({ ok: true, formula: { printPerPage: PAPER_PRINT_PER_PAGE, reamPages: PAPER_REAM_PAGES, reamPrice: PAPER_REAM_PRICE }, pages, minPartial: PAPER_MIN_PARTIAL });
  } catch (err) {
    return json({ error: 'Erreur : ' + err.message }, 500);
  }
}

import { json } from './_shared.js';
import { getPaperConfig, paperPagesFor, loadCatalogue, PAPER_MIN_PARTIAL } from './_paper.js';

/* Endpoint public — prix de la page (ram blanc / ram couleur) et nombre de pages de chaque matière, pour afficher au
   client le nombre de pages et le total de sa sélection. Le total réel est de toute façon recalculé à l'enregistrement. */
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
    return json({ ok: true, price: cfg.price, overrides: cfg.overrides, pages, minPartial: PAPER_MIN_PARTIAL });
  } catch (err) {
    return json({ error: 'Erreur : ' + err.message }, 500);
  }
}

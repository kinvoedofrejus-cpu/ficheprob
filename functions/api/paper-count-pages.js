import { json } from './_shared.js';
import { getPaperConfig, paperPagesFor, loadCatalogue } from './_paper.js';

/* Public — POST /api/paper-count-pages { keys:["CE1::francais", …] } (12 au plus par appel)
   Compte (et met en cache) le nombre de pages réel de chaque matière demandée, lu dans le PDF de base.
   Réponse : { pages: { "CE1::francais": 312, … } }. Sert à afficher au client le total de pages de son choix. */
export async function onRequestPost(context) {
  const { request, env } = context;
  try {
    const b = await request.json().catch(() => ({}));
    const keys = (Array.isArray(b.keys) ? b.keys : []).map(String).slice(0, 12);
    const cfg = await getPaperConfig(env.FPB_DB);
    const cat = await loadCatalogue(env, request);
    const pages = {};
    for (const key of keys) {
      const [classe, matiere] = key.split('::');
      if (!classe || !matiere || !cat[classe] || !cat[classe][matiere]) continue;
      const r = await paperPagesFor(env, cfg, classe, matiere, Number(cat[classe][matiere].count) || 0, { countPdf: true });
      if (r.pages) pages[key] = r.pages;
    }
    return json({ ok: true, pages });
  } catch (err) {
    return json({ error: 'Erreur : ' + err.message }, 500);
  }
}

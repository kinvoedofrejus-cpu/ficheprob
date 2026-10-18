import { requireAdmin, json } from './_shared.js';
import { setPaperConfig } from './_paper.js';

/* Admin : prix des fiches papier PAR PAGE (ram blanc / ram couleur), par défaut et par classe + matière, et nombre de
   pages. Body : { token, price:{blanc,couleur}, overrides:{ 'CE1::francais':{blanc,couleur} }, pages:{ 'CE1::francais':n },
   pagesPerFiche }. Vide ou 0 = non défini. */
export async function onRequestPost(context) {
  const { request, env } = context;
  try {
    const { token, price, overrides, pages, pagesPerFiche } = await request.json();
    if (!(await requireAdmin(env, token))) return json({ error: 'Non autorisé' }, 401);
    const saved = await setPaperConfig(env.FPB_DB, { price, overrides, pages, pagesPerFiche });
    return json({ ok: true, ...saved });
  } catch (err) {
    return json({ error: 'Erreur : ' + err.message }, 500);
  }
}

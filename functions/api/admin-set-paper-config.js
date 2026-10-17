import { requireAdmin, json } from './_shared.js';
import { setPaperConfig } from './_paper.js';

/* Admin : prix d'une fiche en version papier (FCFA). Vide ou 0 = non défini (total « à confirmer »). */
export async function onRequestPost(context) {
  const { request, env } = context;
  try {
    const { token, pricePerFiche } = await request.json();
    if (!(await requireAdmin(env, token))) return json({ error: 'Non autorisé' }, 401);
    const saved = await setPaperConfig(env.FPB_DB, pricePerFiche);
    return json({ ok: true, ...saved });
  } catch (err) {
    return json({ error: 'Erreur : ' + err.message }, 500);
  }
}

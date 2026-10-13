import { requireAdmin, json, setReadyFichePrices } from './_shared.js';

/* Modifie les prix des Fiches Prêtes : prix par défaut + prix particuliers par
   matière (clé "classe::matiere"). Un prix à 0 rend la fiche gratuite. */
export async function onRequestPost(context) {
  const { request, env } = context;
  try {
    const { token, defaultPrice, overrides } = await request.json();
    if (!(await requireAdmin(env, token))) return json({ error: 'Non autorisé' }, 401);
    const saved = await setReadyFichePrices(env.FPB_DB, defaultPrice, overrides || {});
    return json({ ok: true, ...saved });
  } catch (err) {
    return json({ error: 'Erreur : ' + err.message }, 500);
  }
}

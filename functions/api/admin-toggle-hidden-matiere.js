import { requireAdmin, json, getHiddenMatieres, saveHiddenMatieres, hiddenMatiereKey } from './_shared.js';

export async function onRequestPost(context) {
  const { request, env } = context;
  const kv = env.FPB_KV;
  try {
    const { token, classe, matiere, hidden } = await request.json();
    if (!(await requireAdmin(env, token))) return json({ error: 'Non autorisé' }, 401);

    const cleanClasse = (classe || '').trim();
    const cleanMatiere = (matiere || '').trim();
    if (!cleanClasse || !cleanMatiere) {
      return json({ error: 'Classe et matière sont obligatoires' }, 400);
    }

    const key = hiddenMatiereKey(cleanClasse, cleanMatiere);
    const list = await getHiddenMatieres(kv);
    const isCurrentlyHidden = list.includes(key);
    let next;
    if (hidden === false) {
      next = list.filter(k => k !== key);
    } else if (hidden === true) {
      next = isCurrentlyHidden ? list : [...list, key];
    } else {
      // Pas de valeur explicite fournie : on bascule l'état actuel
      next = isCurrentlyHidden ? list.filter(k => k !== key) : [...list, key];
    }

    await saveHiddenMatieres(kv, next);
    return json({ ok: true, hidden: next });
  } catch (err) {
    return json({ error: 'Erreur lors de la mise à jour : ' + err.message }, 500);
  }
}

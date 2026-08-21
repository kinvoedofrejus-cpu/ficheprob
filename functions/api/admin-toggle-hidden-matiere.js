import { requireAdmin, json, getHiddenMatieres, setHiddenMatiere, hiddenMatiereKey } from './_shared.js';

export async function onRequestPost(context) {
  const { request, env } = context;
  const db = env.FPB_DB;
  try {
    const { token, classe, matiere, hidden } = await request.json();
    if (!(await requireAdmin(env, token))) return json({ error: 'Non autorisé' }, 401);

    const cleanClasse = (classe || '').trim();
    const cleanMatiere = (matiere || '').trim();
    if (!cleanClasse || !cleanMatiere) {
      return json({ error: 'Classe et matière sont obligatoires' }, 400);
    }

    const key = hiddenMatiereKey(cleanClasse, cleanMatiere);
    const list = await getHiddenMatieres(db);
    const isCurrentlyHidden = list.includes(key);
    let wantHidden;
    if (hidden === false) wantHidden = false;
    else if (hidden === true) wantHidden = true;
    else wantHidden = !isCurrentlyHidden; // Pas de valeur explicite fournie : on bascule l'état actuel

    const next = await setHiddenMatiere(db, cleanClasse, cleanMatiere, wantHidden);
    return json({ ok: true, hidden: next });
  } catch (err) {
    return json({ error: 'Erreur lors de la mise à jour : ' + err.message }, 500);
  }
}

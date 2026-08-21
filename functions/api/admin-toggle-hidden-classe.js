import { requireAdmin, json, getHiddenClasses, setHiddenClasse } from './_shared.js';

export async function onRequestPost(context) {
  const { request, env } = context;
  const db = env.FPB_DB;
  try {
    const { token, classe, hidden } = await request.json();
    if (!(await requireAdmin(env, token))) return json({ error: 'Non autorisé' }, 401);

    const cleanClasse = (classe || '').trim();
    if (!cleanClasse) {
      return json({ error: 'Classe obligatoire' }, 400);
    }

    const list = await getHiddenClasses(db);
    const isCurrentlyHidden = list.includes(cleanClasse);
    let wantHidden;
    if (hidden === false) wantHidden = false;
    else if (hidden === true) wantHidden = true;
    else wantHidden = !isCurrentlyHidden; // Pas de valeur explicite fournie : on bascule l'état actuel

    const next = await setHiddenClasse(db, cleanClasse, wantHidden);
    return json({ ok: true, hidden: next });
  } catch (err) {
    return json({ error: 'Erreur lors de la mise à jour : ' + err.message }, 500);
  }
}

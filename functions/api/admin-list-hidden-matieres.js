import { requireAdmin, json, getHiddenMatieres, getHiddenClasses } from './_shared.js';

export async function onRequestPost(context) {
  const { request, env } = context;
  const db = env.FPB_DB;
  try {
    const { token } = await request.json();
    if (!(await requireAdmin(env, token))) return json({ error: 'Non autorisé' }, 401);

    const [hidden, hiddenClasses] = await Promise.all([
      getHiddenMatieres(db),
      getHiddenClasses(db)
    ]);
    return json({ ok: true, hidden, hiddenClasses });
  } catch (err) {
    return json({ error: 'Erreur lors du chargement des matières/classes masquées : ' + err.message }, 500);
  }
}

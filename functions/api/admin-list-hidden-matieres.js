import { requireAdmin, json, getHiddenMatieres } from './_shared.js';

export async function onRequestPost(context) {
  const { request, env } = context;
  const db = env.FPB_DB;
  try {
    const { token } = await request.json();
    if (!(await requireAdmin(env, token))) return json({ error: 'Non autorisé' }, 401);

    const hidden = await getHiddenMatieres(db);
    return json({ ok: true, hidden });
  } catch (err) {
    return json({ error: 'Erreur lors du chargement des matières masquées : ' + err.message }, 500);
  }
}

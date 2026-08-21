import { requireAdmin, json, deletePromo } from './_shared.js';

export async function onRequestPost(context) {
  const { request, env } = context;
  const db = env.FPB_DB;
  try {
    const { token, id } = await request.json();
    if (!(await requireAdmin(env, token))) return json({ error: 'Non autorisé' }, 401);
    if (!id) return json({ error: 'Identifiant manquant' }, 400);

    const removed = await deletePromo(db, id);
    if (!removed) return json({ error: 'Promotion introuvable' }, 404);

    return json({ ok: true });
  } catch (err) {
    return json({ error: 'Erreur lors de la suppression de la promotion : ' + err.message }, 500);
  }
}

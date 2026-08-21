import { requireAdmin, json, deleteUser } from './_shared.js';

export async function onRequestPost(context) {
  const { request, env } = context;
  const db = env.FPB_DB;
  try {
    const { token, phone } = await request.json();
    if (!(await requireAdmin(env, token))) return json({ error: 'Non autorisé' }, 401);
    if (!phone) return json({ error: 'Numéro manquant' }, 400);

    await deleteUser(db, phone);
    // Le code d'accès est une colonne de la table users (UNIQUE), donc il est
    // automatiquement libéré dès la suppression de la ligne — pas d'étape séparée.

    return json({ ok: true });
  } catch (err) {
    return json({ error: 'Erreur lors de la suppression du compte : ' + err.message }, 500);
  }
}

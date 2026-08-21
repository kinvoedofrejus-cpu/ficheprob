import { requireAdmin, json, getUser, upsertUser } from './_shared.js';

export async function onRequestPost(context) {
  const { request, env } = context;
  const db = env.FPB_DB;
  try {
    const { token, phone, active } = await request.json();
    if (!(await requireAdmin(env, token))) return json({ error: 'Non autorisé' }, 401);
    if (!phone) return json({ error: 'Numéro manquant' }, 400);

    const record = await getUser(db, phone);
    if (!record) return json({ error: 'Utilisateur introuvable' }, 404);

    record.active = !!active;
    record.updatedAt = Date.now();
    await upsertUser(db, record);

    return json({ ok: true });
  } catch (err) {
    return json({ error: 'Erreur lors de la mise à jour du compte : ' + err.message }, 500);
  }
}

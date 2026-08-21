import { normalizePhone, requireAdmin, json, getUser, renameUserPhone } from './_shared.js';

export async function onRequestPost(context) {
  const { request, env } = context;
  const db = env.FPB_DB;
  try {
    const { token, oldPhone, newPhone } = await request.json();
    if (!(await requireAdmin(env, token))) return json({ error: 'Non autorisé' }, 401);

    const oldDigits = normalizePhone(oldPhone);
    const newDigits = normalizePhone(newPhone);
    if (oldDigits.length < 8 || newDigits.length < 8) {
      return json({ error: 'Numéro invalide' }, 400);
    }
    if (oldDigits === newDigits) return json({ ok: true });

    const record = await getUser(db, oldDigits);
    if (!record) return json({ error: 'Utilisateur introuvable' }, 404);

    const conflict = await getUser(db, newDigits);
    if (conflict) return json({ error: 'Ce nouveau numéro est déjà utilisé par un autre compte' }, 409);

    await renameUserPhone(db, oldDigits, newDigits);

    return json({ ok: true });
  } catch (err) {
    return json({ error: 'Erreur lors de la mise à jour du numéro : ' + err.message }, 500);
  }
}

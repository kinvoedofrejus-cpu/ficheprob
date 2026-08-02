import { normalizePhone, requireAdmin, json, kvKeyUser, kvKeyCode, kvGetJSON, kvSetJSON, kvDelete } from './_shared.js';

export async function onRequestPost(context) {
  const { request, env } = context;
  const kv = env.FPB_KV;
  try {
    const { token, oldPhone, newPhone } = await request.json();
    if (!(await requireAdmin(env, token))) return json({ error: 'Non autorisé' }, 401);

    const oldDigits = normalizePhone(oldPhone);
    const newDigits = normalizePhone(newPhone);
    if (oldDigits.length < 8 || newDigits.length < 8) {
      return json({ error: 'Numéro invalide' }, 400);
    }
    if (oldDigits === newDigits) return json({ ok: true });

    const record = await kvGetJSON(kv, kvKeyUser(oldDigits));
    if (!record) return json({ error: 'Utilisateur introuvable' }, 404);

    const conflict = await kvGetJSON(kv, kvKeyUser(newDigits));
    if (conflict) return json({ error: 'Ce nouveau numéro est déjà utilisé par un autre compte' }, 409);

    record.phone = newDigits;
    record.updatedAt = Date.now();

    await kvSetJSON(kv, kvKeyUser(newDigits), record);
    await kvDelete(kv, kvKeyUser(oldDigits));

    // Le code pointe vers le numéro de téléphone : le mettre à jour aussi
    if (record.code) {
      await kvSetJSON(kv, kvKeyCode(record.code), { phone: newDigits });
    }

    return json({ ok: true });
  } catch (err) {
    return json({ error: 'Erreur lors de la mise à jour du numéro : ' + err.message }, 500);
  }
}

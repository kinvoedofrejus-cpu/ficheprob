import { requireAdmin, json, kvKeyUser, kvGetJSON, kvSetJSON } from './_shared.js';

export async function onRequestPost(context) {
  const { request, env } = context;
  const kv = env.FPB_KV;
  try {
    const { token, phone, active } = await request.json();
    if (!(await requireAdmin(env, token))) return json({ error: 'Non autorisé' }, 401);
    if (!phone) return json({ error: 'Numéro manquant' }, 400);

    const record = await kvGetJSON(kv, kvKeyUser(phone));
    if (!record) return json({ error: 'Utilisateur introuvable' }, 404);

    record.active = !!active;
    record.updatedAt = Date.now();
    await kvSetJSON(kv, kvKeyUser(phone), record);

    return json({ ok: true });
  } catch (err) {
    return json({ error: 'Erreur lors de la mise à jour du compte : ' + err.message }, 500);
  }
}

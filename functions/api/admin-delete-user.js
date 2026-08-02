import { requireAdmin, json, kvKeyUser, kvKeyCode, kvGetJSON, kvDelete } from './_shared.js';

export async function onRequestPost(context) {
  const { request, env } = context;
  const kv = env.FPB_KV;
  try {
    const { token, phone } = await request.json();
    if (!(await requireAdmin(env, token))) return json({ error: 'Non autorisé' }, 401);
    if (!phone) return json({ error: 'Numéro manquant' }, 400);

    const key = kvKeyUser(phone);
    const record = await kvGetJSON(kv, key);
    if (!record) return json({ error: 'Utilisateur introuvable' }, 404);

    // On supprime aussi le code d'accès associé, sinon il resterait "orphelin" dans le KV
    // et empêcherait de le réattribuer à quelqu'un d'autre.
    if (record.code) {
      await kvDelete(kv, kvKeyCode(record.code)).catch(() => {});
    }
    await kvDelete(kv, key);

    return json({ ok: true });
  } catch (err) {
    return json({ error: 'Erreur lors de la suppression du compte : ' + err.message }, 500);
  }
}

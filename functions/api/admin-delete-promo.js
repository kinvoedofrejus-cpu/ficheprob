import { requireAdmin, json, getPromoList, savePromoList } from './_shared.js';

export async function onRequestPost(context) {
  const { request, env } = context;
  const kv = env.FPB_KV;
  try {
    const { token, id } = await request.json();
    if (!(await requireAdmin(env, token))) return json({ error: 'Non autorisé' }, 401);
    if (!id) return json({ error: 'Identifiant manquant' }, 400);

    const list = await getPromoList(kv);
    const next = list.filter(p => p.id !== id);
    if (next.length === list.length) return json({ error: 'Promotion introuvable' }, 404);

    await savePromoList(kv, next);
    return json({ ok: true });
  } catch (err) {
    return json({ error: 'Erreur lors de la suppression de la promotion : ' + err.message }, 500);
  }
}

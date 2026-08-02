import { requireAdmin, json, getPromoList, findActivePromo } from './_shared.js';

export async function onRequestPost(context) {
  const { request, env } = context;
  const kv = env.FPB_KV;
  try {
    const { token } = await request.json();
    if (!(await requireAdmin(env, token))) return json({ error: 'Non autorisé' }, 401);

    const list = await getPromoList(kv);
    list.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
    const active = findActivePromo(list);

    return json({ ok: true, promos: list, activeId: active ? active.id : null });
  } catch (err) {
    return json({ error: 'Erreur lors du chargement des promotions : ' + err.message }, 500);
  }
}

import { requireAdmin, json, listPromos, findActivePromo } from './_shared.js';

export async function onRequestPost(context) {
  const { request, env } = context;
  const db = env.FPB_DB;
  try {
    const { token } = await request.json();
    if (!(await requireAdmin(env, token))) return json({ error: 'Non autorisé' }, 401);

    const list = await listPromos(db);
    const active = findActivePromo(list);

    return json({ ok: true, promos: list, activeId: active ? active.id : null });
  } catch (err) {
    return json({ error: 'Erreur lors du chargement des promotions : ' + err.message }, 500);
  }
}

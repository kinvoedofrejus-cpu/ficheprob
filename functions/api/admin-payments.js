import { requireAdmin, json, listTx } from './_shared.js';

export async function onRequestPost(context) {
  const { request, env } = context;
  const db = env.FPB_DB;
  try {
    const { token } = await request.json();
    if (!(await requireAdmin(env, token))) return json({ error: 'Non autorisé' }, 401);

    const payments = await listTx(db);
    return json({ ok: true, payments });
  } catch (err) {
    return json({ error: 'Erreur lors du chargement des paiements : ' + err.message }, 500);
  }
}

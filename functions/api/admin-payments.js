import { requireAdmin, json, kvListByPrefix, kvGetJSON } from './_shared.js';

export async function onRequestPost(context) {
  const { request, env } = context;
  const kv = env.FPB_KV;
  try {
    const { token } = await request.json();
    if (!(await requireAdmin(env, token))) return json({ error: 'Non autorisé' }, 401);

    const keys = await kvListByPrefix(kv, 'tx:');
    const payments = [];
    for (const key of keys) {
      const t = await kvGetJSON(kv, key);
      if (t) payments.push({ id: key.replace(/^tx:/, ''), ...t });
    }
    payments.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));

    return json({ ok: true, payments });
  } catch (err) {
    return json({ error: 'Erreur lors du chargement des paiements : ' + err.message }, 500);
  }
}

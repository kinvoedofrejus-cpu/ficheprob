import { requireAdmin, json, kvListByPrefix, kvGetJSON } from './_shared.js';

export async function onRequestPost(context) {
  const { request, env } = context;
  const kv = env.FPB_KV;
  try {
    const { token } = await request.json();
    if (!(await requireAdmin(env, token))) return json({ error: 'Non autorisé' }, 401);

    const keys = await kvListByPrefix(kv, 'user:');
    const users = [];
    for (const key of keys) {
      const record = await kvGetJSON(kv, key);
      if (record) users.push(record);
    }
    users.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));

    return json({ ok: true, users });
  } catch (err) {
    return json({ error: 'Erreur lors du chargement des utilisateurs : ' + err.message }, 500);
  }
}

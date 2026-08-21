import { requireAdmin, json, listUsers } from './_shared.js';

export async function onRequestPost(context) {
  const { request, env } = context;
  const db = env.FPB_DB;
  try {
    const { token } = await request.json();
    if (!(await requireAdmin(env, token))) return json({ error: 'Non autorisé' }, 401);

    const users = await listUsers(db);
    return json({ ok: true, users });
  } catch (err) {
    return json({ error: 'Erreur lors du chargement des utilisateurs : ' + err.message }, 500);
  }
}

import { requireAdmin, json, listUsers } from './_shared.js';

export async function onRequestPost(context) {
  const { request, env } = context;
  const db = env.FPB_DB;
  try {
    const { token } = await request.json();
    if (!(await requireAdmin(env, token))) return json({ error: 'Non autorisé' }, 401);

    const users = await listUsers(db);
    // Emails vérifiés (table créée à la première vérification ; absente = aucun email enregistré)
    const emails = {};
    try {
      const r = await db.prepare('SELECT phone, email FROM account_emails').all();
      for (const x of (r.results || [])) emails[x.phone] = x.email;
    } catch (e) { /* table absente */ }
    for (const u of users) u.email = emails[u.phone] || '';
    return json({ ok: true, users });
  } catch (err) {
    return json({ error: 'Erreur lors du chargement des utilisateurs : ' + err.message }, 500);
  }
}

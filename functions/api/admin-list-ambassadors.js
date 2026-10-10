import { requireAdmin, json, ensureAmbassadorsTable, ambassadorFromRow } from './_shared.js';

/* Cloudflare Function — /api/admin-list-ambassadors (admin) : demandes d'ambassadeurs, plus récentes d'abord. */
export async function onRequestPost(context) {
  const { request, env } = context;
  const db = env.FPB_DB;
  try {
    const { token } = await request.json();
    if (!(await requireAdmin(env, token))) return json({ error: 'Non autorisé' }, 401);
    await ensureAmbassadorsTable(db);
    const { results } = await db.prepare('SELECT * FROM ambassadors ORDER BY id DESC LIMIT 1000').all();
    return json({ ok: true, ambassadors: (results || []).map(ambassadorFromRow) });
  } catch (err) {
    return json({ error: 'Erreur lors du chargement des ambassadeurs : ' + err.message }, 500);
  }
}

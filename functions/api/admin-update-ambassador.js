import { requireAdmin, json, ensureAmbassadorsTable, AMBASSADOR_STATES } from './_shared.js';

/* Cloudflare Function — /api/admin-update-ambassador (admin)
   Body : { token, id, action: 'status', status } ou { token, id, action: 'delete' } */
export async function onRequestPost(context) {
  const { request, env } = context;
  const db = env.FPB_DB;
  try {
    const { token, id, action, status } = await request.json();
    if (!(await requireAdmin(env, token))) return json({ error: 'Non autorisé' }, 401);
    const rowId = parseInt(id, 10);
    if (!rowId) return json({ error: 'Identifiant invalide.' }, 400);
    await ensureAmbassadorsTable(db);

    if (action === 'delete') {
      await db.prepare('DELETE FROM ambassadors WHERE id = ?').bind(rowId).run();
      return json({ ok: true });
    }
    if (action === 'status') {
      if (!AMBASSADOR_STATES.includes(status)) return json({ error: 'Statut invalide.' }, 400);
      await db.prepare('UPDATE ambassadors SET status = ? WHERE id = ?').bind(status, rowId).run();
      return json({ ok: true });
    }
    return json({ error: 'Action inconnue.' }, 400);
  } catch (err) {
    return json({ error: "Erreur lors de la mise à jour de l'ambassadeur : " + err.message }, 500);
  }
}

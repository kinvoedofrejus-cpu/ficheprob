import { requireAdmin, json, ensureSuggestionsTable, SUGGESTION_STATUTS } from './_shared.js';

/* { token, action:'status', ids:[…]|id, status } ou { token, action:'delete', ids:[…]|id } */
export async function onRequestPost(context) {
  const { request, env } = context;
  const db = env.FPB_DB;
  try {
    const { token, action, id, ids, status } = await request.json();
    if (!(await requireAdmin(env, token))) return json({ error: 'Non autorisé' }, 401);
    await ensureSuggestionsTable(db);
    const list = (Array.isArray(ids) ? ids : [id]).map(Number).filter(n => Number.isInteger(n) && n > 0).slice(0, 500);
    if (!list.length) return json({ error: 'Identifiant manquant' }, 400);
    const marks = list.map(() => '?').join(',');
    if (action === 'status') {
      if (!SUGGESTION_STATUTS.includes(status)) return json({ error: 'Statut invalide' }, 400);
      await db.prepare(`UPDATE suggestions SET status = ? WHERE id IN (${marks})`).bind(status, ...list).run();
      return json({ ok: true });
    }
    if (action === 'delete') {
      await db.prepare(`DELETE FROM suggestions WHERE id IN (${marks})`).bind(...list).run();
      return json({ ok: true, deleted: list.length });
    }
    return json({ error: 'Action inconnue' }, 400);
  } catch (err) {
    return json({ error: 'Erreur : ' + err.message }, 500);
  }
}

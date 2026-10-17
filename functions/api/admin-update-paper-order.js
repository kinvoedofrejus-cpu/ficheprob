import { requireAdmin, json } from './_shared.js';
import { ensurePaperOrdersTable, orderFromRow, applyPaperPayment, PAPER_STATUSES } from './_paper.js';

/* Admin : { id, action, … }
   - status  : { status } ('nouvelle' | 'confirmee' | 'livree' | 'annulee')
   - payment : { amount } paiement reçu hors ligne (espèces, Mobile Money direct…), ajouté au « payé »
   - total   : { total } montant total fixé à la main (vide = « à confirmer »)
   - note    : { note } note interne
   - delete */
export async function onRequestPost(context) {
  const { request, env } = context;
  const db = env.FPB_DB;
  try {
    const b = await request.json();
    if (!(await requireAdmin(env, b.token))) return json({ error: 'Non autorisé' }, 401);
    const id = Number(b.id);
    if (!Number.isFinite(id)) return json({ error: 'Commande invalide.' }, 400);
    await ensurePaperOrdersTable(db);
    const row = await db.prepare('SELECT * FROM paper_orders WHERE id = ?').bind(id).first();
    if (!row) return json({ error: 'Commande introuvable.' }, 404);
    const now = Date.now();

    if (b.action === 'delete') {
      await db.prepare('DELETE FROM paper_orders WHERE id = ?').bind(id).run();
      return json({ ok: true, deleted: true });
    }
    if (b.action === 'status') {
      if (!PAPER_STATUSES.includes(b.status)) return json({ error: 'Statut invalide.' }, 400);
      await db.prepare('UPDATE paper_orders SET status = ?, updated_at = ? WHERE id = ?').bind(b.status, now, id).run();
    } else if (b.action === 'payment') {
      const a = Math.round(Number(b.amount));
      if (!Number.isFinite(a) || a <= 0) return json({ error: 'Montant invalide.' }, 400);
      await applyPaperPayment(db, id, a);
    } else if (b.action === 'total') {
      const raw = String(b.total === undefined || b.total === null ? '' : b.total).trim();
      const t = raw === '' ? null : Math.round(Number(raw));
      if (t !== null && (!Number.isFinite(t) || t < 0)) return json({ error: 'Total invalide.' }, 400);
      await db.prepare('UPDATE paper_orders SET total = ?, updated_at = ? WHERE id = ?').bind(t, now, id).run();
    } else if (b.action === 'note') {
      await db.prepare('UPDATE paper_orders SET note = ?, updated_at = ? WHERE id = ?').bind(String(b.note || '').slice(0, 500), now, id).run();
    } else {
      return json({ error: 'Action inconnue.' }, 400);
    }
    const next = await db.prepare('SELECT * FROM paper_orders WHERE id = ?').bind(id).first();
    return json({ ok: true, order: orderFromRow(next) });
  } catch (err) {
    return json({ error: 'Erreur : ' + err.message }, 500);
  }
}

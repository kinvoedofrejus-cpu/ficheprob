import { json, getTx, upsertTx, fetchFedaTransaction, FEDAPAY_SECRET_KEY_HARDCODED } from './_shared.js';
import { processApprovedTransaction } from './_pay-finalize.js';

/* /api/payment-status?id=<transaction> — état d'un paiement FedaPay.
   Si la transaction est encore « en attente » chez nous, on la VÉRIFIE directement auprès de FedaPay : le paiement
   est pris en compte même si le webhook est en retard ou n'est jamais arrivé (c'est ce qui permet à l'application de
   reprendre le processus en cours dès le retour du client). */
export async function onRequestGet(context) {
  const { request, env } = context;
  const db = env.FPB_DB;
  const url = new URL(request.url);
  const id = url.searchParams.get('id');

  if (!id) return json({ error: 'Paramètre id manquant' }, 400);

  try {
    let record = await getTx(db, id);
    if (!record) return json({ status: 'unknown' }, 404);

    if (record.status === 'pending') {
      try {
        const tx = await fetchFedaTransaction(FEDAPAY_SECRET_KEY_HARDCODED, id);
        const st = tx && String(tx.status || '').toLowerCase();
        if (st === 'approved' || st === 'transferred') {
          await processApprovedTransaction(db, { ...tx, id: tx.id || id });
          record = (await getTx(db, id)) || record;
        } else if (st === 'declined' || st === 'canceled' || st === 'cancelled' || st === 'refunded') {
          await upsertTx(db, id, { ...record, status: 'failed' });
          record = (await getTx(db, id)) || record;
        }
      } catch (e) { /* FedaPay injoignable : on renvoie l'état connu, le client réessaiera */ }
    }

    return json({
      status: record.status,
      code: record.type === 'readyfiche' ? null : (record.code || null),   // jamais le hachage du jeton d'un achat sans compte
      phone: record.phone,
      planIndex: record.planIndex,
      type: record.type || 'subscription',
      classe: record.classe || null,
      matiere: record.matiere || null
    });
  } catch (err) {
    return json({ error: 'Erreur lors de la vérification du paiement : ' + err.message }, 500);
  }
}

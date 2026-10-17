import { json } from './_shared.js';
import { findOrderRow, orderFromRow, publicOrder } from './_paper.js';

/* Cloudflare Function — /api/paper-order-status (public)
   Suivi d'une commande papier. Body : { numero, whatsapp } — les deux doivent correspondre (8 derniers chiffres du
   numéro). Renvoie la commande avec ce qui a été payé (sert aussi à fabriquer le reçu, une fois payé). */
export async function onRequestPost(context) {
  const { request, env } = context;
  try {
    const b = await request.json();
    const row = await findOrderRow(env.FPB_DB, b.numero, b.whatsapp);
    if (!row) return json({ ok: false, error: 'Aucune commande trouvée avec ces informations.' }, 404);
    return json({ ok: true, order: publicOrder(orderFromRow(row)) });
  } catch (err) {
    return json({ error: 'Erreur lors de la recherche de la commande : ' + err.message }, 500);
  }
}

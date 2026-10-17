import { json, upsertTx, FEDAPAY_SECRET_KEY_HARDCODED } from './_shared.js';
import { findOrderRow, orderFromRow, PAPER_MIN_PARTIAL } from './_paper.js';

/* Cloudflare Function — /api/pay-paper-order (public)
   Crée un paiement FedaPay pour une commande papier : la totalité du reste à payer, ou une partie (minimum
   PAPER_MIN_PARTIAL). Peut être appelé plusieurs fois (acomptes successifs, ou paiement après prise de contact).
   Body : { numero, whatsapp, mode:'total'|'partial', amount? }
   Le webhook (webhook.js, type « paperorder ») ajoute le montant au « payé » de la commande une fois confirmé. */
const FEDAPAY_API_BASE = 'https://api.fedapay.com/v1';

export async function onRequestPost(context) {
  const { request, env } = context;
  const db = env.FPB_DB;
  const secretKey = FEDAPAY_SECRET_KEY_HARDCODED;
  if (!secretKey) return json({ error: 'Clé FedaPay non configurée côté serveur.' }, 500);
  let b;
  try { b = await request.json(); } catch { return json({ error: 'Requête invalide.' }, 400); }
  try {
    const row = await findOrderRow(db, b.numero, b.whatsapp);
    if (!row) return json({ error: 'Commande introuvable.' }, 404);
    const o = orderFromRow(row);
    if (o.status === 'annulee') return json({ error: 'Cette commande est annulée.' }, 400);
    if (!o.total || o.total <= 0) return json({ error: "Le montant de cette commande sera confirmé par l'équipe sur WhatsApp." }, 400);
    const reste = o.total - o.paid;
    if (reste <= 0) return json({ error: 'Cette commande est déjà entièrement payée.' }, 400);

    let amount = reste;
    if (b.mode === 'partial') {
      const a = Math.round(Number(b.amount));
      if (!Number.isFinite(a) || a < PAPER_MIN_PARTIAL) return json({ error: 'Montant minimum : ' + PAPER_MIN_PARTIAL + ' FCFA.' }, 400);
      amount = Math.min(a, reste);
    } else if (b.mode !== 'total') {
      return json({ error: 'Mode de paiement invalide.' }, 400);
    }

    const parts = o.nomFiche.split(' ');
    const customer = { firstname: parts[0].slice(0, 60) || 'Client', lastname: (parts.slice(1).join(' ') || 'FicheProBot').slice(0, 60) };
    const description = 'Commande papier FicheProBot ' + o.numero + ' - ' + o.classe;

    const txRes = await fetch(`${FEDAPAY_API_BASE}/transactions`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${secretKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ description, amount, currency: { iso: 'XOF' }, customer })
    });
    const txData = await txRes.json();
    if (!txRes.ok) return json({ error: txData.message || 'Erreur lors de la création de la transaction.' }, 502);
    const transactionId = (txData['v1/transaction'] && txData['v1/transaction'].id) || txData.id;
    if (!transactionId) return json({ error: 'Identifiant de transaction introuvable.' }, 502);

    const tokenRes = await fetch(`${FEDAPAY_API_BASE}/transactions/${transactionId}/token`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${secretKey}`, 'Content-Type': 'application/json' }
    });
    const tokenData = await tokenRes.json();
    if (!tokenRes.ok || !tokenData.url) return json({ error: tokenData.message || 'Erreur lors de la génération du lien de paiement.' }, 502);

    // Réservation (type « paperorder ») AVANT la redirection : le webhook retrouve la commande par l'identifiant stocké dans « matiere ».
    await upsertTx(db, transactionId, {
      type: 'paperorder', status: 'pending', phone: o.whatsapp, classe: o.classe,
      matiere: String(row.id), tier: 'paper', amount, createdAt: Date.now()
    });
    return json({ ok: true, url: tokenData.url, transactionId, amount });
  } catch (err) {
    return json({ error: 'Erreur réseau vers FedaPay.' }, 500);
  }
}

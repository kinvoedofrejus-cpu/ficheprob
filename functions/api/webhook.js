import {
  PLANS, normalizePhone, json,
  getUser, upsertUser, getTx, upsertTx, generateUniqueCode,
  verifyFedaPaySignatureDebug, addResumePurchase,
  FEDAPAY_WEBHOOK_SECRET_HARDCODED
} from './_shared.js';

function planIndexFromAmount(amount) {
  return PLANS.findIndex(p => p.amount === amount);
}

export async function onRequestPost(context) {
  const { request, env } = context;
  const db = env.FPB_DB;

  const rawBody = await request.text();
  const sig = request.headers.get('x-fedapay-signature');

  const debug = await verifyFedaPaySignatureDebug(FEDAPAY_WEBHOOK_SECRET_HARDCODED, rawBody, sig);
  if (!debug.valid) {
    console.error('Signature webhook FedaPay invalide', debug);
    // DIAGNOSTIC TEMPORAIRE : ces infos apparaissent dans la colonne "Réponse"
    // des Logs FedaPay (dashboard > Webhooks > Logs). À retirer une fois le
    // format de signature confirmé.
    return json({
      error: 'Signature invalide',
      debug: {
        headerSig: debug.headerSig,
        sigFromHeader: debug.sigFromHeader,
        ts: debug.ts || null,
        candidates: debug.candidates
      }
    }, 400);
  }

  let fedaEvent;
  try {
    fedaEvent = JSON.parse(rawBody);
  } catch (err) {
    return json({ error: 'Payload invalide' }, 400);
  }

  try {
    if (fedaEvent.name === 'transaction.approved') {
      const tx = fedaEvent.object;

      // Déjà traité ? (FedaPay peut renvoyer le même webhook plusieurs fois)
      const already = await getTx(db, tx.id);

      // Réservation de type "résumés" (achat d'une matière complète via
      // create-resume-payment.js) : traitement dédié, distinct de l'abonnement.
      if (already && already.type === 'resume') {
        if (already.status !== 'paid') {
          await addResumePurchase(db, already.phone, already.classe, already.matiere, tx.id);
          await upsertTx(db, tx.id, { ...already, status: 'paid', paidAt: Date.now() });
          console.log(`✅ Paiement résumé confirmé — transaction ${tx.id} — ${already.phone} — ${already.matiere} (${already.classe})`);
        }
        return json({ received: true });
      }

      if (already && already.status === 'paid') {
        return json({ received: true });
      }

      // Cas 1 : transaction créée via notre bouton "Payer automatiquement"
      // (réservation préalable avec planIndex + téléphone par create-payment.js)
      let planIndex = already ? already.planIndex : undefined;
      let phone = already ? already.phone : undefined;
      let nom = already ? already.nom : undefined;
      let prenom = already ? already.prenom : undefined;

      // Cas 2 : transaction créée depuis un lien de paiement fixe FedaPay —
      // pas de réservation préalable, on retrouve le plan par le montant payé
      // et les infos client directement dans la transaction FedaPay.
      if (planIndex === undefined || planIndex === null) {
        planIndex = planIndexFromAmount(tx.amount);
      }
      if (!phone && tx.customer && tx.customer.phone_number) {
        phone = normalizePhone(tx.customer.phone_number.number || tx.customer.phone_number);
      }
      if (!nom && tx.customer) nom = tx.customer.lastname || tx.customer.last_name || '';
      if (!prenom && tx.customer) prenom = tx.customer.firstname || tx.customer.first_name || '';

      if (planIndex === -1 || planIndex === undefined || !PLANS[planIndex]) {
        console.error('Webhook: plan introuvable pour ce paiement (montant:', tx.amount, ')');
        await upsertTx(db, tx.id, { status: 'paid_unmatched', amount: tx.amount, createdAt: Date.now() });
        return json({ received: true });
      }
      if (!phone || normalizePhone(phone).length < 8) {
        console.error('Webhook: numéro de téléphone manquant/invalide pour la transaction', tx.id);
        await upsertTx(db, tx.id, { status: 'paid_unmatched', planIndex, amount: tx.amount, createdAt: Date.now() });
        return json({ received: true });
      }

      const phoneDigits = normalizePhone(phone);
      const plan = PLANS[planIndex];

      const existingUser = await getUser(db, phoneDigits);
      const code = await generateUniqueCode(db, 8);
      if (!code) {
        console.error('Webhook: impossible de générer un code unique');
        return json({ received: true });
      }

      const now = Date.now();
      const expiryTs = now + plan.days * 86400000;

      const userRecord = {
        phone: phoneDigits,
        nom: nom || (existingUser ? existingUser.nom : '') || 'Client',
        prenom: prenom || (existingUser ? existingUser.prenom : '') || '',
        code,
        planIndex,
        planLabel: plan.label,
        classe: existingUser ? existingUser.classe : null,
        expiryTs,
        quotaTotal: plan.quota,
        quotaUsed: existingUser ? existingUser.quotaUsed || 0 : 0,
        active: true,
        createdAt: existingUser ? existingUser.createdAt : now,
        updatedAt: now,
        history: [
          ...((existingUser && existingUser.history) || []),
          { code, planLabel: plan.label, expiryTs, generatedAt: now, source: 'fedapay' }
        ]
      };

      await upsertUser(db, userRecord);

      await upsertTx(db, tx.id, {
        source: 'fedapay',
        status: 'paid',
        planIndex,
        phone: phoneDigits,
        nom: userRecord.nom,
        prenom: userRecord.prenom,
        amount: tx.amount,
        code,
        paidAt: now,
        createdAt: now
      });

      console.log(`✅ Paiement confirmé — transaction ${tx.id} — compte ${phoneDigits} — code ${code}`);
    } else if (fedaEvent.name === 'transaction.declined' || fedaEvent.name === 'transaction.canceled') {
      const tx = fedaEvent.object;
      const record = await getTx(db, tx.id);
      if (record) {
        await upsertTx(db, tx.id, { ...record, status: 'failed' });
      }
    }
  } catch (e) {
    console.error('Erreur traitement webhook:', e);
  }

  return json({ received: true });
}

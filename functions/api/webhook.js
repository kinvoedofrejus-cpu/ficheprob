import {
  PLANS, normalizePhone, randomCode, json,
  kvKeyUser, kvKeyCode, kvKeyTx,
  kvGetJSON, kvSetJSON, kvDelete,
  verifyFedaPaySignature
} from './_shared.js';

function planIndexFromAmount(amount) {
  return PLANS.findIndex(p => p.amount === amount);
}

async function ensureUniqueCode(kv) {
  for (let i = 0; i < 5; i++) {
    const candidate = randomCode(8);
    const taken = await kv.get(kvKeyCode(candidate));
    if (!taken) return candidate;
  }
  return null;
}

export async function onRequestPost(context) {
  const { request, env } = context;
  const kv = env.FPB_KV;

  const rawBody = await request.text();
  const sig = request.headers.get('x-fedapay-signature');

  const valid = await verifyFedaPaySignature(env.FEDAPAY_WEBHOOK_SECRET || '', rawBody, sig);
  if (!valid) {
    console.error('Signature webhook FedaPay invalide');
    return json({ error: 'Signature invalide' }, 400);
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
      const txKey = kvKeyTx(tx.id);

      // Déjà traité ? (FedaPay peut renvoyer le même webhook plusieurs fois)
      const already = await kvGetJSON(kv, txKey);
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
        await kvSetJSON(kv, txKey, { status: 'paid_unmatched', amount: tx.amount, createdAt: Date.now() });
        return json({ received: true });
      }
      if (!phone || normalizePhone(phone).length < 8) {
        console.error('Webhook: numéro de téléphone manquant/invalide pour la transaction', tx.id);
        await kvSetJSON(kv, txKey, { status: 'paid_unmatched', planIndex, amount: tx.amount, createdAt: Date.now() });
        return json({ received: true });
      }

      const phoneDigits = normalizePhone(phone);
      const plan = PLANS[planIndex];

      const existingUser = await kvGetJSON(kv, kvKeyUser(phoneDigits));
      const code = await ensureUniqueCode(kv);
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

      if (existingUser && existingUser.code) {
        await kvDelete(kv, kvKeyCode(existingUser.code)).catch(() => {});
      }

      await kvSetJSON(kv, kvKeyUser(phoneDigits), userRecord);
      await kvSetJSON(kv, kvKeyCode(code), { phone: phoneDigits });

      await kvSetJSON(kv, txKey, {
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
      const txKey = kvKeyTx(tx.id);
      const record = await kvGetJSON(kv, txKey);
      if (record) {
        record.status = 'failed';
        await kvSetJSON(kv, txKey, record);
      }
    }
  } catch (e) {
    console.error('Erreur traitement webhook:', e);
  }

  return json({ received: true });
}

const { Webhook } = require('fedapay');
const { getStore } = require('@netlify/blobs');
const { PLANS, normalizePhone, randomCode } = require('./_shared');

const FEDAPAY_WEBHOOK_SECRET = process.env.FEDAPAY_WEBHOOK_SECRET || '';

function planIndexFromAmount(amount) {
  return PLANS.findIndex(p => p.amount === amount);
}

async function ensureUniqueCode(codesStore) {
  for (let i = 0; i < 5; i++) {
    const candidate = randomCode(8);
    const taken = await codesStore.get(candidate, { type: 'json' });
    if (!taken) return candidate;
  }
  return null;
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Méthode non autorisée' };
  }

  const sig = event.headers['x-fedapay-signature'] || event.headers['X-FEDAPAY-SIGNATURE'];
  let fedaEvent;
  try {
    fedaEvent = Webhook.constructEvent(event.body, sig, FEDAPAY_WEBHOOK_SECRET);
  } catch (err) {
    console.error('Signature webhook invalide:', err.message);
    return { statusCode: 400, body: 'Signature invalide' };
  }

  try {
    const txStore = getStore({ name: 'ficheprobot-transactions', consistency: 'strong' });

    if (fedaEvent.name === 'transaction.approved') {
      const tx = fedaEvent.object;
      const txKey = String(tx.id);

      // Déjà traité ? (FedaPay peut renvoyer le même webhook plusieurs fois)
      const already = await txStore.get(txKey, { type: 'json' });
      if (already && already.status === 'paid') {
        return { statusCode: 200, body: JSON.stringify({ received: true }) };
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
        await txStore.setJSON(txKey, { status: 'paid_unmatched', amount: tx.amount, createdAt: Date.now() });
        return { statusCode: 200, body: JSON.stringify({ received: true }) };
      }
      if (!phone || normalizePhone(phone).length < 8) {
        console.error('Webhook: numéro de téléphone manquant/invalide pour la transaction', txKey);
        await txStore.setJSON(txKey, { status: 'paid_unmatched', planIndex, amount: tx.amount, createdAt: Date.now() });
        return { statusCode: 200, body: JSON.stringify({ received: true }) };
      }

      const phoneDigits = normalizePhone(phone);
      const plan = PLANS[planIndex];

      const usersStore = getStore({ name: 'ficheprobot-users', consistency: 'strong' });
      const codesStore = getStore({ name: 'ficheprobot-codes-index', consistency: 'strong' });

      const existingUser = await usersStore.get(phoneDigits, { type: 'json' });
      const code = await ensureUniqueCode(codesStore);
      if (!code) {
        console.error('Webhook: impossible de générer un code unique');
        return { statusCode: 200, body: JSON.stringify({ received: true }) };
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
        await codesStore.delete(existingUser.code).catch(() => {});
      }

      await usersStore.setJSON(phoneDigits, userRecord);
      await codesStore.setJSON(code, { phone: phoneDigits });

      await txStore.setJSON(txKey, {
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

      console.log(`✅ Paiement confirmé — transaction ${txKey} — compte ${phoneDigits} — code ${code}`);
    } else if (fedaEvent.name === 'transaction.declined' || fedaEvent.name === 'transaction.canceled') {
      const tx = fedaEvent.object;
      const record = await txStore.get(String(tx.id), { type: 'json' });
      if (record) {
        record.status = 'failed';
        await txStore.setJSON(String(tx.id), record);
      }
    }
  } catch (e) {
    console.error('Erreur traitement webhook:', e);
  }

  return { statusCode: 200, body: JSON.stringify({ received: true }) };
};

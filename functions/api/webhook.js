import {
  PLANS, normalizePhone, json,
  getUser, upsertUser, getTx, upsertTx, generateUniqueCode,
  verifyFedaPaySignatureDebug, addResumePurchase, addReadyFichePurchase, addResourcePurchase,
  FEDAPAY_WEBHOOK_SECRET_HARDCODED, MIN_PLAN_INDEX, getMinPlanBonus
} from './_shared.js';
import { applyPaperPayment } from './_paper.js';
import { processApprovedTransaction } from './_pay-finalize.js';

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
      await processApprovedTransaction(db, fedaEvent.object);
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

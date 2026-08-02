import {
  PLANS, normalizePhone, randomCode, json,
  kvKeyUser, kvKeyCode, kvKeyTx, kvGetJSON, kvSetJSON, kvDelete,
  getPromoList, findActivePromo
} from './_shared.js';

export async function onRequestPost(context) {
  const { request, env } = context;
  const kv = env.FPB_KV;
  try {
    const { nom, prenom, phone, planIndex } = await request.json();

    const list = await getPromoList(kv);
    const active = findActivePromo(list);
    if (!active || active.planIndex !== planIndex) {
      return json({ error: "Cette formule n'est plus en promotion gratuite." }, 400);
    }

    const plan = PLANS[planIndex];
    if (!plan) return json({ error: 'Plan invalide' }, 400);

    const phoneDigits = normalizePhone(phone);
    if (phoneDigits.length < 8) return json({ error: 'Numéro de téléphone invalide' }, 400);
    if (!nom || !nom.trim()) return json({ error: 'Nom manquant' }, 400);

    const existing = await kvGetJSON(kv, kvKeyUser(phoneDigits));

    let code;
    for (let i = 0; i < 5; i++) {
      const candidate = randomCode(8);
      const taken = await kvGetJSON(kv, kvKeyCode(candidate));
      if (!taken) { code = candidate; break; }
    }
    if (!code) return json({ error: 'Impossible de générer un code unique, réessaie.' }, 500);

    const now = Date.now();
    const expiryTs = now + plan.days * 86400000;

    const record = {
      phone: phoneDigits,
      nom: nom.trim(),
      prenom: (prenom || '').trim(),
      code,
      planIndex,
      planLabel: plan.label,
      expiryTs,
      quotaTotal: plan.quota,
      quotaUsed: existing ? existing.quotaUsed || 0 : 0,
      active: true,
      createdAt: existing ? existing.createdAt : now,
      updatedAt: now,
      history: [
        ...((existing && existing.history) || []),
        { code, planLabel: plan.label, expiryTs, generatedAt: now, source: 'promo' }
      ]
    };

    if (existing && existing.code) {
      await kvDelete(kv, kvKeyCode(existing.code)).catch(() => {});
    }

    await kvSetJSON(kv, kvKeyUser(phoneDigits), record);
    await kvSetJSON(kv, kvKeyCode(code), { phone: phoneDigits });

    await kvSetJSON(kv, kvKeyTx(`promo_${now}`), {
      source: 'promo',
      status: 'paid',
      planIndex,
      phone: phoneDigits,
      nom: record.nom,
      prenom: record.prenom,
      amount: 0,
      code,
      paidAt: now,
      createdAt: now
    });

    return json({ ok: true, code, expiryTs, quotaTotal: plan.quota, planLabel: plan.label });
  } catch (err) {
    return json({ error: "Erreur lors de l'obtention de l'offre : " + err.message }, 500);
  }
}

import {
  PLANS, normalizePhone, json,
  getUser, upsertUser, upsertTx, generateUniqueCode,
  listPromos, findActivePromo
} from './_shared.js';

export async function onRequestPost(context) {
  const { request, env } = context;
  const db = env.FPB_DB;
  try {
    const { nom, prenom, phone, planIndex } = await request.json();

    const list = await listPromos(db);
    const active = findActivePromo(list);
    if (!active || active.planIndex !== planIndex) {
      return json({ error: "Cette formule n'est plus en promotion gratuite." }, 400);
    }

    const plan = PLANS[planIndex];
    if (!plan) return json({ error: 'Plan invalide' }, 400);

    const phoneDigits = normalizePhone(phone);
    if (phoneDigits.length < 8) return json({ error: 'Numéro de téléphone invalide' }, 400);
    if (!nom || !nom.trim()) return json({ error: 'Nom manquant' }, 400);

    const existing = await getUser(db, phoneDigits);

    const code = await generateUniqueCode(db, 8);
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
      classe: existing ? existing.classe : null,
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

    await upsertUser(db, record);

    await upsertTx(db, `promo_${now}`, {
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

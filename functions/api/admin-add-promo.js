import {
  PLANS, requireAdmin, json, randomCode,
  getPromoList, savePromoList, findActivePromo,
  kvListByPrefix, kvGetJSON, kvSetJSON
} from './_shared.js';

export async function onRequestPost(context) {
  const { request, env } = context;
  const kv = env.FPB_KV;
  try {
    const { token, planIndex, startAt, endAt, message } = await request.json();
    if (!(await requireAdmin(env, token))) return json({ error: 'Non autorisé' }, 401);

    if (planIndex === null || planIndex === undefined || !PLANS[planIndex]) {
      return json({ error: 'Choisis une formule valide pour la promotion' }, 400);
    }
    const start = Number(startAt);
    if (!start || Number.isNaN(start)) {
      return json({ error: 'Date de début invalide' }, 400);
    }
    const end = endAt ? Number(endAt) : null;
    if (end && end <= start) {
      return json({ error: 'La date de fin doit être après la date de début' }, 400);
    }

    const now = Date.now();
    const list = await getPromoList(kv);

    const promo = {
      id: randomCode(10),
      planIndex,
      startAt: start,
      endAt: end,
      message: (message || '').trim(),
      enabled: true,
      createdAt: now
    };
    list.push(promo);
    await savePromoList(kv, list);

    let grantedCount = 0;
    // Si la promo démarre immédiatement (ou dans le passé), on distribue tout de
    // suite le bonus de quota aux abonnés déjà actifs, comme avant.
    if (start <= now) {
      const plan = PLANS[planIndex];
      const keys = await kvListByPrefix(kv, 'user:');
      const endsAt = end || (now + plan.days * 86400000);

      for (const key of keys) {
        const record = await kvGetJSON(kv, key);
        if (!record || !record.active) continue;
        if (record.expiryTs <= now) continue;

        record.quotaTotal = (record.quotaTotal || 0) + plan.quota;
        record.promo = {
          quotaBonus: plan.quota,
          planLabel: plan.label,
          message: promo.message,
          grantedAt: now,
          endsAt
        };
        record.updatedAt = now;
        await kvSetJSON(kv, key, record);
        grantedCount++;
      }
    }

    return json({ ok: true, promo, grantedCount });
  } catch (err) {
    return json({ error: 'Erreur lors de la création de la promotion : ' + err.message }, 500);
  }
}

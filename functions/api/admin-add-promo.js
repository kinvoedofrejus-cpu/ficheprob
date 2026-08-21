import {
  PLANS, requireAdmin, json, randomCode,
  listPromos, insertPromo, listUsers, upsertUser
} from './_shared.js';

export async function onRequestPost(context) {
  const { request, env } = context;
  const db = env.FPB_DB;
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

    const promo = {
      id: randomCode(10),
      planIndex,
      startAt: start,
      endAt: end,
      message: (message || '').trim(),
      enabled: true,
      createdAt: now
    };
    await insertPromo(db, promo);

    let grantedCount = 0;
    // Si la promo démarre immédiatement (ou dans le passé), on distribue tout de
    // suite le bonus de quota aux abonnés déjà actifs, comme avant.
    if (start <= now) {
      const plan = PLANS[planIndex];
      const users = await listUsers(db);
      const endsAt = end || (now + plan.days * 86400000);

      for (const record of users) {
        if (!record.active) continue;
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
        await upsertUser(db, record);
        grantedCount++;
      }
    }

    return json({ ok: true, promo, grantedCount });
  } catch (err) {
    return json({ error: 'Erreur lors de la création de la promotion : ' + err.message }, 500);
  }
}

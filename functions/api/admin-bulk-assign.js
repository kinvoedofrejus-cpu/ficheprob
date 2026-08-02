import {
  PLANS, requireAdmin, json,
  kvKeyUser, kvKeyTx, kvGetJSON, kvSetJSON
} from './_shared.js';

/* Attribue une formule à plusieurs comptes existants en une seule opération.
   Contrairement à admin-generate-code (un seul client, nouveau code généré),
   ici on NE change PAS le code d'accès de l'utilisateur : on met juste à jour
   son plan, son quota et sa date d'expiration, pour ne pas avoir à redistribuer
   de nouveaux codes à tout le monde. */
export async function onRequestPost(context) {
  const { request, env } = context;
  const kv = env.FPB_KV;
  try {
    const { token, phones, planIndex } = await request.json();
    if (!(await requireAdmin(env, token))) return json({ error: 'Non autorisé' }, 401);

    const plan = PLANS[planIndex];
    if (!plan) return json({ error: 'Plan invalide' }, 400);
    if (!Array.isArray(phones) || phones.length === 0) {
      return json({ error: 'Aucun utilisateur sélectionné' }, 400);
    }

    const now = Date.now();
    const expiryTs = now + plan.days * 86400000;
    let updated = 0;
    const failed = [];

    for (const phone of phones) {
      const key = kvKeyUser(phone);
      const record = await kvGetJSON(kv, key);
      if (!record) { failed.push(phone); continue; }

      record.planIndex = planIndex;
      record.planLabel = plan.label;
      record.quotaTotal = plan.quota;
      record.expiryTs = expiryTs;
      record.active = true;
      record.updatedAt = now;
      record.history = [
        ...(record.history || []),
        { code: record.code, planLabel: plan.label, expiryTs, generatedAt: now, source: 'attribution_groupee' }
      ];
      await kvSetJSON(kv, key, record);

      await kvSetJSON(kv, kvKeyTx(`bulk_${now}_${phone}`), {
        source: 'attribution_groupee',
        status: 'paid',
        planIndex,
        phone,
        nom: record.nom,
        prenom: record.prenom,
        amount: 0,
        code: record.code,
        paidAt: now,
        createdAt: now
      });

      updated++;
    }

    return json({ ok: true, updated, failed, planLabel: plan.label, expiryTs });
  } catch (err) {
    return json({ error: "Erreur lors de l'attribution groupée : " + err.message }, 500);
  }
}

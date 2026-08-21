import {
  PLANS, normalizePhone, requireAdmin, json,
  getUser, upsertUser, upsertTx, generateUniqueCode
} from './_shared.js';

const VALID_CLASSES = ['maternelle', 'ci-cp', 'ce1-cm2'];

export async function onRequestPost(context) {
  const { request, env } = context;
  const db = env.FPB_DB;
  try {
    const { token, phone, nom, prenom, planIndex, classe } = await request.json();
    if (!(await requireAdmin(env, token))) return json({ error: 'Non autorisé' }, 401);

    const plan = PLANS[planIndex];
    if (!plan) return json({ error: 'Plan invalide' }, 400);

    const phoneDigits = normalizePhone(phone);
    if (phoneDigits.length < 8) return json({ error: 'Numéro de téléphone invalide' }, 400);
    if (!nom || !nom.trim()) return json({ error: 'Nom manquant' }, 400);

    const cleanClasse = (classe || '').trim().toLowerCase();
    if (!VALID_CLASSES.includes(cleanClasse)) {
      return json({ error: 'Classe invalide (choisis Maternelle, CI-CP ou CE1-CM2)' }, 400);
    }

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
      classe: cleanClasse,
      expiryTs,
      quotaTotal: plan.quota,
      quotaUsed: existing ? existing.quotaUsed || 0 : 0,
      active: true,
      createdAt: existing ? existing.createdAt : now,
      updatedAt: now,
      history: [
        ...((existing && existing.history) || []),
        { code, planLabel: plan.label, expiryTs, generatedAt: now }
      ]
    };

    await upsertUser(db, record);

    await upsertTx(db, `manual_${now}`, {
      source: 'manuel',
      planIndex,
      phone: phoneDigits,
      nom: record.nom,
      prenom: record.prenom,
      status: 'paid',
      amount: plan.amount,
      paidAt: now,
      createdAt: now
    });

    return json({ ok: true, code, expiryTs, quotaTotal: plan.quota, planLabel: plan.label, classe: cleanClasse });
  } catch (err) {
    return json({ error: 'Erreur lors de la génération du code : ' + err.message }, 500);
  }
}

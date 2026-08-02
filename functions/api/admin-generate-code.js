import {
  PLANS, normalizePhone, randomCode, requireAdmin, json,
  kvKeyUser, kvKeyCode, kvKeyTx, kvGetJSON, kvSetJSON, kvDelete
} from './_shared.js';

const VALID_CLASSES = ['maternelle', 'ci-cp', 'ce1-cm2'];

export async function onRequestPost(context) {
  const { request, env } = context;
  const kv = env.FPB_KV;
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

    if (existing && existing.code) {
      await kvDelete(kv, kvKeyCode(existing.code)).catch(() => {});
    }

    await kvSetJSON(kv, kvKeyUser(phoneDigits), record);
    await kvSetJSON(kv, kvKeyCode(code), { phone: phoneDigits });

    await kvSetJSON(kv, kvKeyTx(`manual_${now}`), {
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

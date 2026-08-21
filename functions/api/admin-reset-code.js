import { requireAdmin, json, getUser, upsertUser, generateUniqueCode } from './_shared.js';

export async function onRequestPost(context) {
  const { request, env } = context;
  const db = env.FPB_DB;
  try {
    const { token, phone } = await request.json();
    if (!(await requireAdmin(env, token))) return json({ error: 'Non autorisé' }, 401);
    if (!phone) return json({ error: 'Numéro manquant' }, 400);

    const record = await getUser(db, phone);
    if (!record) return json({ error: 'Utilisateur introuvable' }, 404);

    const newCode = await generateUniqueCode(db, 8);
    if (!newCode) return json({ error: 'Impossible de générer un code unique, réessaie.' }, 500);

    const now = Date.now();
    record.code = newCode;
    record.updatedAt = now;
    record.history = [...(record.history || []), { code: newCode, planLabel: record.planLabel, expiryTs: record.expiryTs, generatedAt: now, reset: true }];

    await upsertUser(db, record);

    return json({ ok: true, code: newCode });
  } catch (err) {
    return json({ error: 'Erreur lors de la réinitialisation du code : ' + err.message }, 500);
  }
}

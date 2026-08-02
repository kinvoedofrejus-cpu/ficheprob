import {
  randomCode, requireAdmin, json,
  kvKeyUser, kvKeyCode, kvGetJSON, kvSetJSON, kvDelete
} from './_shared.js';

export async function onRequestPost(context) {
  const { request, env } = context;
  const kv = env.FPB_KV;
  try {
    const { token, phone } = await request.json();
    if (!(await requireAdmin(env, token))) return json({ error: 'Non autorisé' }, 401);
    if (!phone) return json({ error: 'Numéro manquant' }, 400);

    const record = await kvGetJSON(kv, kvKeyUser(phone));
    if (!record) return json({ error: 'Utilisateur introuvable' }, 404);

    let newCode;
    for (let i = 0; i < 5; i++) {
      const candidate = randomCode(8);
      const taken = await kvGetJSON(kv, kvKeyCode(candidate));
      if (!taken) { newCode = candidate; break; }
    }
    if (!newCode) return json({ error: 'Impossible de générer un code unique, réessaie.' }, 500);

    if (record.code) await kvDelete(kv, kvKeyCode(record.code)).catch(() => {});

    const now = Date.now();
    record.code = newCode;
    record.updatedAt = now;
    record.history = [...(record.history || []), { code: newCode, planLabel: record.planLabel, expiryTs: record.expiryTs, generatedAt: now, reset: true }];

    await kvSetJSON(kv, kvKeyUser(phone), record);
    await kvSetJSON(kv, kvKeyCode(newCode), { phone });

    return json({ ok: true, code: newCode });
  } catch (err) {
    return json({ error: 'Erreur lors de la réinitialisation du code : ' + err.message }, 500);
  }
}

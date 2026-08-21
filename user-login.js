import { normalizePhone, json, kvKeyUser, kvGetJSON } from './_shared.js';

export async function onRequestPost(context) {
  const { request, env } = context;
  const kv = env.FPB_KV;
  try {
    const { phone, code } = await request.json();
    const phoneDigits = normalizePhone(phone);
    const cleanCode = (code || '').trim().toUpperCase();
    if (phoneDigits.length < 8 || !cleanCode) {
      return json({ ok: false, reason: 'invalid' }, 400);
    }

    const record = await kvGetJSON(kv, kvKeyUser(phoneDigits));
    if (!record || (record.code || '').toUpperCase() !== cleanCode) {
      return json({ ok: false, reason: 'invalid' }, 401);
    }
    if (!record.active) return json({ ok: false, reason: 'inactive' }, 403);
    if (record.expiryTs <= Date.now()) return json({ ok: false, reason: 'expired' }, 403);

    const promo = (record.promo && record.promo.endsAt > Date.now()) ? record.promo : null;

    return json({
      ok: true,
      profile: {
        phone: record.phone,
        nom: record.nom,
        prenom: record.prenom,
        code: record.code,
        planLabel: record.planLabel,
        expiryTs: record.expiryTs,
        quotaTotal: record.quotaTotal,
        quotaUsed: record.quotaUsed,
        classe: record.classe || null,
        promo
      }
    });
  } catch (err) {
    return json({ error: 'Erreur lors de la connexion : ' + err.message }, 500);
  }
}

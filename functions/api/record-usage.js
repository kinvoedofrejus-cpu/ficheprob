import { normalizePhone, json, kvKeyUser, kvGetJSON, kvSetJSON } from './_shared.js';

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

    record.quotaUsed = (record.quotaUsed || 0) + 1;
    record.updatedAt = Date.now();
    await kvSetJSON(kv, kvKeyUser(phoneDigits), record);

    return json({ ok: true, quotaUsed: record.quotaUsed, quotaTotal: record.quotaTotal });
  } catch (err) {
    return json({ error: 'Erreur lors de la mise à jour du quota : ' + err.message }, 500);
  }
                }

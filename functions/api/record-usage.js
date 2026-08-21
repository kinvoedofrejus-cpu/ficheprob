import { normalizePhone, json, getUser, upsertUser } from './_shared.js';

const OWNER_PHONE_HARDCODED = '0166661846';
const OWNER_CODE_HARDCODED = 'KINVOS';

export async function onRequestPost(context) {
  const { request, env } = context;
  const db = env.FPB_DB;
  try {
    const { phone, code } = await request.json();
    const phoneDigits = normalizePhone(phone);
    const cleanCode = (code || '').trim().toUpperCase();
    if (phoneDigits.length < 8 || !cleanCode) {
      return json({ ok: false, reason: 'invalid' }, 400);
    }

    if (phoneDigits === normalizePhone(OWNER_PHONE_HARDCODED) && cleanCode === OWNER_CODE_HARDCODED) {
      return json({ ok: true, quotaUsed: 0, quotaTotal: 999999999 });
    }

    const record = await getUser(db, phoneDigits);
    if (!record || (record.code || '').toUpperCase() !== cleanCode) {
      return json({ ok: false, reason: 'invalid' }, 401);
    }
    if (!record.active) return json({ ok: false, reason: 'inactive' }, 403);
    if (record.expiryTs <= Date.now()) return json({ ok: false, reason: 'expired' }, 403);

    record.quotaUsed = (record.quotaUsed || 0) + 1;
    record.updatedAt = Date.now();
    await upsertUser(db, record);

    return json({ ok: true, quotaUsed: record.quotaUsed, quotaTotal: record.quotaTotal });
  } catch (err) {
    return json({ error: 'Erreur lors de la mise à jour du quota : ' + err.message }, 500);
  }
}

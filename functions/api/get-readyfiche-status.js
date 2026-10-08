import { normalizePhone, json, getUser, getReadyFichePurchases, getReadyFicheDownloads } from './_shared.js';

export async function onRequestPost(context) {
  const { request, env } = context;
  const db = env.FPB_DB;
  try {
    const { phone, code } = await request.json();
    const phoneDigits = normalizePhone(phone);
    const cleanCode = (code || '').trim().toUpperCase();
    if (phoneDigits.length < 8 || !cleanCode) return json({ ok: false, reason: 'invalid' }, 400);

    const record = await getUser(db, phoneDigits);
    if (!record || (record.code || '').toUpperCase() !== cleanCode) {
      return json({ ok: false, reason: 'invalid' }, 401);
    }

    const purchases = await getReadyFichePurchases(db, phoneDigits);
    const downloads = await getReadyFicheDownloads(db, phoneDigits);
    return json({ ok: true, purchases, downloads });
  } catch (err) {
    return json({ error: 'Erreur : ' + err.message }, 500);
  }
}

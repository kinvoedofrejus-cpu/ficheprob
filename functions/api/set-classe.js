import { normalizePhone, json, getUser, upsertUser } from './_shared.js';

const VALID_CLASSES = ['maternelle', 'ci-cp', 'ce1-cm2'];

export async function onRequestPost(context) {
  const { request, env } = context;
  const db = env.FPB_DB;
  try {
    const { phone, code, classe } = await request.json();
    const phoneDigits = normalizePhone(phone);
    const cleanCode = (code || '').trim().toUpperCase();
    const cleanClasse = (classe || '').trim().toLowerCase();

    if (phoneDigits.length < 8 || !cleanCode || !VALID_CLASSES.includes(cleanClasse)) {
      return json({ ok: false, reason: 'invalid' }, 400);
    }

    const record = await getUser(db, phoneDigits);
    if (!record || (record.code || '').toUpperCase() !== cleanCode) {
      return json({ ok: false, reason: 'invalid' }, 401);
    }

    // On ne permet de fixer la classe qu'une seule fois par compte
    // (pour éviter qu'un compte CI-CP ne bascule seul sur CE1-CM2, etc.).
    if (!record.classe) {
      record.classe = cleanClasse;
      record.updatedAt = Date.now();
      await upsertUser(db, record);
    }

    return json({ ok: true, classe: record.classe });
  } catch (err) {
    return json({ error: 'Erreur : ' + err.message }, 500);
  }
}

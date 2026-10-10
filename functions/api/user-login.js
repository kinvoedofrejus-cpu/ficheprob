import { normalizePhone, json, getUser, isAmbassadorUser } from './_shared.js';

/* ---------- Compte administrateur codé en dur (abonnement illimité, sans date sur les fiches) ---------- */
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
      return json({
        ok: true,
        profile: {
          phone: OWNER_PHONE_HARDCODED,
          nom: 'KINVOEDO FREJUS S.E',
          prenom: '',
          code: OWNER_CODE_HARDCODED,
          planLabel: 'Illimité',
          expiryTs: Date.now() + 100 * 365 * 24 * 60 * 60 * 1000,
          quotaTotal: 999999999,
          quotaUsed: 0,
          classe: null,
          promo: null,
          unlimited: true
        }
      });
    }

    const record = await getUser(db, phoneDigits);
    if (!record || (record.code || '').toUpperCase() !== cleanCode) {
      return json({ ok: false, reason: 'invalid' }, 401);
    }
    if (!record.active) return json({ ok: false, reason: 'inactive' }, 403);
    if (record.expiryTs <= Date.now()) return json({ ok: false, reason: 'expired' }, 403);

    const promo = (record.promo && record.promo.endsAt > Date.now()) ? record.promo : null;
    const ambassador = isAmbassadorUser(record);

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
        promo,
        // Compte ambassadeur : avantages « illimité » du propriétaire (fiches et téléchargements gratuits
        // illimités) mais nom figé, fiche verrouillée après PDF, et validité 1 an renouvelable.
        ...(ambassador ? { unlimited: true, ambassador: true } : {})
      }
    });
  } catch (err) {
    return json({ error: 'Erreur lors de la connexion : ' + err.message }, 500);
  }
}

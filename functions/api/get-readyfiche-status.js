import { normalizePhone, json, getUser, getReadyFichePurchases, getReadyFicheDownloads } from './_shared.js';

// Cloudflare Function — /api/get-readyfiche-status
//
// Renvoie, pour le compte donné, la liste des matières "Fiche Prête" déjà
// achetées (purchases, avec le joker matiere:'*' pour un achat "toute la
// classe") et celles déjà téléchargées une fois (downloads — verrou
// définitif, voir record-readyfiche-download.js). L'appli s'en sert pour
// savoir, pour chaque classe+matière, s'il faut proposer le paiement,
// l'écran de téléchargement, ou le message "déjà téléchargée".

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

    const isOwner = phoneDigits === normalizePhone(OWNER_PHONE_HARDCODED) && cleanCode === OWNER_CODE_HARDCODED;

    if (!isOwner) {
      const record = await getUser(db, phoneDigits);
      if (!record || (record.code || '').toUpperCase() !== cleanCode) {
        return json({ ok: false, reason: 'invalid' }, 401);
      }
      if (!record.active) return json({ ok: false, reason: 'inactive' }, 403);
      if (record.expiryTs <= Date.now()) return json({ ok: false, reason: 'expired' }, 403);
    }

    const purchases = isOwner ? [] : await getReadyFichePurchases(db, phoneDigits);
    const downloads = isOwner ? [] : await getReadyFicheDownloads(db, phoneDigits);

    return json({ ok: true, purchases, downloads });
  } catch (err) {
    return json({ error: 'Erreur lors du chargement des fiches prêtes : ' + err.message }, 500);
  }
}

import {
  normalizePhone, json, getUser,
  getReadyFichePurchases, hasReadyFichePurchase,
  getReadyFicheDownloads, hasReadyFicheDownload, addReadyFicheDownload
} from './_shared.js';

// Cloudflare Function — /api/record-readyfiche-download
//
// Verrou définitif du téléchargement d'une "Fiche Prête" : chaque matière
// achetée (à l'unité ou via "toute la classe") ne peut être téléchargée
// qu'UNE SEULE FOIS, point vérifié et posé ici côté serveur (pas seulement
// côté appli, pour rester fiable même en cas de changement d'appareil).
// Appelé juste avant la génération réelle du PDF : si la réponse n'est pas
// ok, l'appli n'a pas le droit de générer/télécharger le fichier.

const OWNER_PHONE_HARDCODED = '0166661846';
const OWNER_CODE_HARDCODED = 'KINVOS';

export async function onRequestPost(context) {
  const { request, env } = context;
  const db = env.FPB_DB;
  try {
    const { phone, code, classe, matiere } = await request.json();
    const phoneDigits = normalizePhone(phone);
    const cleanCode = (code || '').trim().toUpperCase();
    if (phoneDigits.length < 8 || !cleanCode || !classe || !matiere) {
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

      const purchases = await getReadyFichePurchases(db, phoneDigits);
      if (!hasReadyFichePurchase(purchases, classe, matiere)) {
        return json({ ok: false, reason: 'notpurchased' }, 403);
      }

      const downloads = await getReadyFicheDownloads(db, phoneDigits);
      if (hasReadyFicheDownload(downloads, classe, matiere)) {
        return json({ ok: false, reason: 'alreadydownloaded' }, 409);
      }

      await addReadyFicheDownload(db, phoneDigits, classe, matiere);
    }

    return json({ ok: true });
  } catch (err) {
    return json({ error: "Erreur lors de l'enregistrement du téléchargement : " + err.message }, 500);
  }
}

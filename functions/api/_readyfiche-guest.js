import { getTx, hashGuestToken, guestDownloadKey, getReadyFicheDownloads, hasReadyFicheDownload } from './_shared.js';

/* Vérifie qu'un achat SANS compte (jeton + transaction payée) donne le droit de télécharger cette matière.
   Remplace checkGuestReadyFiche de _shared.js (18/10/2026) pour accepter aussi le forfait « toute la classe » :
   la transaction porte alors matiere = '*' et couvre CHAQUE matière de la classe, UN téléchargement par matière. */
export async function checkGuestReadyFiche(db, txId, token, classe, matiere) {
  if (!txId || !token || String(token).length < 16 || !classe || !matiere) return { ok: false, reason: 'invalid', status: 400 };
  const tx = await getTx(db, txId);
  if (!tx || tx.type !== 'readyfiche' || tx.tier !== 'guest') return { ok: false, reason: 'invalid', status: 401 };
  if ((await hashGuestToken(token)) !== tx.code) return { ok: false, reason: 'invalid', status: 401 };
  if (tx.status !== 'paid' || tx.classe !== classe || (tx.matiere !== matiere && tx.matiere !== '*')) {
    return { ok: false, reason: 'notpurchased', status: 403 };
  }
  const done = await getReadyFicheDownloads(db, guestDownloadKey(tx.id));
  if (hasReadyFicheDownload(done, classe, matiere)) return { ok: false, reason: 'alreadydownloaded', status: 409 };
  return { ok: true, tx };
}

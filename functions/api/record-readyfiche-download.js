import {
  normalizePhone, json, getUser,
  getReadyFichePurchases, hasReadyFichePurchase,
  getReadyFicheDownloads, hasReadyFicheDownload, addReadyFicheDownload, isAmbassadorUser, getReadyFichePrices, readyFichePriceFor,
  guestDownloadKey, readyFormatOfTx, readyFormatAllowed } from './_shared.js';
import { checkGuestReadyFiche } from './_readyfiche-guest.js';

// Le PDF doit déjà être construit côté client AVANT cet appel (voir
// downloadReadyFiche dans index.html) : on ne consomme le droit de
// téléchargement UNIQUE qu'après coup, jamais avant — ainsi un échec de
// génération du PDF ne brûle jamais le droit.
export async function onRequestPost(context) {
  const { request, env } = context;
  const db = env.FPB_DB;
  try {
    const { phone, code, classe, matiere, guest, txId, guestToken, format } = await request.json();
    const fmt = format === 'word' ? 'word' : 'pdf';   // absent (ancienne version de l'appli) = PDF
    if (guest === true) {
      if (!classe || !matiere) return json({ ok: false, reason: 'invalid' }, 400);
      if (!txId) {
        // Matière gratuite sans compte : rien à consommer.
        if (readyFichePriceFor(await getReadyFichePrices(db), classe, matiere) > 0) return json({ ok: false, reason: 'notpurchased' }, 403);
        return json({ ok: true });
      }
      const chk = await checkGuestReadyFiche(db, txId, guestToken, classe, matiere);
      if (!chk.ok) return json({ ok: false, reason: chk.reason }, chk.status);
      // Forfait classe : seulement le format payé (PDF ou Word).
      if (chk.tx && chk.tx.matiere === '*' && readyFormatOfTx(chk.tx) !== fmt) return json({ ok: false, reason: 'wrongformat', expected: readyFormatOfTx(chk.tx) }, 403);
      await addReadyFicheDownload(db, guestDownloadKey(txId), classe, matiere);
      return json({ ok: true });
    }
    const phoneDigits = normalizePhone(phone);
    const cleanCode = (code || '').trim().toUpperCase();
    if (phoneDigits.length < 8 || !cleanCode || !classe || !matiere) {
      return json({ ok: false, reason: 'invalid' }, 400);
    }

    const record = await getUser(db, phoneDigits);
    if (!record || (record.code || '').toUpperCase() !== cleanCode) {
      return json({ ok: false, reason: 'invalid' }, 401);
    }

    const purchases = await getReadyFichePurchases(db, phoneDigits);
    if (!isAmbassadorUser(record) && !hasReadyFichePurchase(purchases, classe, matiere) &&
          readyFichePriceFor(await getReadyFichePrices(db), classe, matiere) > 0) {
      return json({ ok: false, reason: 'notpurchased' }, 403);
    }

    if (!isAmbassadorUser(record) && !(await readyFormatAllowed(db, purchases, classe, matiere, fmt))) {
      return json({ ok: false, reason: 'wrongformat' }, 403);
    }

    const downloads = await getReadyFicheDownloads(db, phoneDigits);
    if (hasReadyFicheDownload(downloads, classe, matiere)) {
      return json({ ok: false, reason: 'alreadydownloaded' }, 409);
    }

    await addReadyFicheDownload(db, phoneDigits, classe, matiere);
    return json({ ok: true });
  } catch (err) {
    return json({ error: 'Erreur : ' + err.message }, 500);
  }
}

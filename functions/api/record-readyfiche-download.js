import {
  normalizePhone, json, getUser,
  getReadyFichePurchases, hasReadyFichePurchase,
  getReadyFicheDownloads, hasReadyFicheDownload, addReadyFicheDownload
} from './_shared.js';

// Le PDF doit déjà être construit côté client AVANT cet appel (voir
// downloadReadyFiche dans index.html) : on ne consomme le droit de
// téléchargement UNIQUE qu'après coup, jamais avant — ainsi un échec de
// génération du PDF ne brûle jamais le droit.
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

    const record = await getUser(db, phoneDigits);
    if (!record || (record.code || '').toUpperCase() !== cleanCode) {
      return json({ ok: false, reason: 'invalid' }, 401);
    }

    const purchases = await getReadyFichePurchases(db, phoneDigits);
    if (!hasReadyFichePurchase(purchases, classe, matiere)) {
      return json({ ok: false, reason: 'notpurchased' }, 403);
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

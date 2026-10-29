import { normalizePhone, getUser, getReadyFichePurchases, hasReadyFichePurchase, isAmbassadorUser, getReadyFichePrices, readyFichePriceFor, readyFormatOfTx, readyFormatAllowed } from './_shared.js';
import { checkGuestReadyFiche } from './_readyfiche-guest.js';

const OWNER_PHONE_HARDCODED = '0166661846';
const OWNER_CODE_HARDCODED = 'KINVOS';

// Cloudflare Function — /api/get-readyfiche-docx  (29/10/2026)
//
// Sert le Word de BASE (nouveau modèle, sans nom d'enseignant ni filigrane) d'une matière « Fiche Prête », stocké dans R2 sous
// readyfiche-docx/{classe}/{matiere}.docx (dépôt : admin-upload-readyfiche-word.html). Le client (downloadReadyFiche dans
// index.html) le personnalise ensuite dans le navigateur — voir ready-docx.js.
//
// Même protection par achat que get-readyfiche-pdf.js, et en plus : un forfait « toute la classe » PDF ne donne pas accès au Word
// (et inversement) — le forfait ne vaut que pour le format payé. Une matière achetée à l'unité ou gratuite vaut pour les deux.
export async function onRequestPost(context) {
  const { request, env } = context;
  const db = env.FPB_DB;
  try {
    const { phone, code, classe, matiere, guest, txId, guestToken } = await request.json();
    const phoneDigits = normalizePhone(phone);
    const cleanCode = (code || '').trim().toUpperCase();
    if (guest === true) {
      if (!classe || !matiere) return new Response('Requête invalide', { status: 400 });
      if (txId) {
        const chk = await checkGuestReadyFiche(db, txId, guestToken, classe, matiere);
        if (!chk.ok) return new Response('Accès refusé (' + chk.reason + ')', { status: chk.status });
        if (chk.tx && chk.tx.matiere === '*' && readyFormatOfTx(chk.tx) !== 'word') return new Response('Forfait PDF : format Word non inclus', { status: 403 });
      } else if (readyFichePriceFor(await getReadyFichePrices(db), classe, matiere) > 0) {
        return new Response('Matière non achetée', { status: 403 });
      }
    } else if (phoneDigits.length < 8 || !cleanCode || !classe || !matiere) {
      return new Response('Requête invalide', { status: 400 });
    }

    const isOwner = guest !== true && phoneDigits === normalizePhone(OWNER_PHONE_HARDCODED) && cleanCode === OWNER_CODE_HARDCODED;
    if (guest !== true && !isOwner) {
      const record = await getUser(db, phoneDigits);
      if (!record || (record.code || '').toUpperCase() !== cleanCode) return new Response('Compte invalide', { status: 401 });
      const purchases = await getReadyFichePurchases(db, phoneDigits);
      if (!isAmbassadorUser(record) && !hasReadyFichePurchase(purchases, classe, matiere) &&
          readyFichePriceFor(await getReadyFichePrices(db), classe, matiere) > 0) {
        return new Response('Matière non achetée', { status: 403 });
      }
      if (!isAmbassadorUser(record) && !(await readyFormatAllowed(db, purchases, classe, matiere, 'word'))) {
        return new Response('Forfait PDF : format Word non inclus', { status: 403 });
      }
    }

    if (!/^[A-Za-z0-9_-]+$/.test(String(classe)) || !/^[A-Za-z0-9_-]+$/.test(String(matiere)) || String(matiere) === '*') {
      return new Response('Requête invalide', { status: 400 });
    }
    const obj = await env.FPB_IMAGES.get(`readyfiche-docx/${classe}/${matiere}.docx`);
    if (!obj) return new Response('Word introuvable (pas encore déposé)', { status: 404 });
    return new Response(obj.body, {
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'Cache-Control': 'private, no-store'
      }
    });
  } catch (err) {
    return new Response('Erreur : ' + err.message, { status: 500 });
  }
}

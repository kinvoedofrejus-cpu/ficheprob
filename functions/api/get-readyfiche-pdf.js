import { normalizePhone, getUser, getReadyFichePurchases, hasReadyFichePurchase, isAmbassadorUser } from './_shared.js';

// Cloudflare Function — /api/get-readyfiche-pdf
//
// Sert le PDF de BASE (sans nom d'enseignant ni filigrane — voir
// admin-pregenerate-readyfiches.js) d'une matière "Fiche Prête" déjà
// pré-générée et stockée dans R2 sous readyfiche-pdfs/{classe}/{matiere}.pdf.
// Le client (downloadReadyFiche dans index.html) l'injecte ensuite avec
// pdf-lib pour y ajouter le nom de l'enseignant + le filigrane — voir
// stampReadyFichePdf() — ce qui est quasi instantané même pour une matière
// de 300+ fiches, car le plus lourd (mise en page + rendu de chaque fiche)
// a déjà été fait une seule fois côté serveur.
//
// Protégé par achat : uniquement les comptes ayant acheté cette matière (ou
// toute la classe) peuvent récupérer le PDF.
export async function onRequestPost(context) {
  const { request, env } = context;
  const db = env.FPB_DB;
  try {
    const { phone, code, classe, matiere } = await request.json();
    const phoneDigits = normalizePhone(phone);
    const cleanCode = (code || '').trim().toUpperCase();
    if (phoneDigits.length < 8 || !cleanCode || !classe || !matiere) {
      return new Response('Requête invalide', { status: 400 });
    }

    const record = await getUser(db, phoneDigits);
    if (!record || (record.code || '').toUpperCase() !== cleanCode) {
      return new Response('Compte invalide', { status: 401 });
    }

    const purchases = await getReadyFichePurchases(db, phoneDigits);
    if (!isAmbassadorUser(record) && !hasReadyFichePurchase(purchases, classe, matiere)) {
      return new Response('Matière non achetée', { status: 403 });
    }

    const key = `readyfiche-pdfs/${classe}/${matiere}.pdf`;
    const obj = await env.FPB_IMAGES.get(key);
    if (!obj) {
      // Pas encore pré-généré côté serveur (ex: classe ajoutée mais
      // pré-génération pas encore lancée) — le client retombe alors sur la
      // génération classique à la volée.
      return new Response('PDF de base introuvable (pas encore pré-généré)', { status: 404 });
    }

    return new Response(obj.body, {
      headers: {
        'Content-Type': 'application/pdf',
        'Cache-Control': 'private, no-store'
      }
    });
  } catch (err) {
    return new Response('Erreur : ' + err.message, { status: 500 });
  }
}

import { normalizePhone, json, getUser, getReadyFichePurchases, hasReadyFichePurchase, isAmbassadorUser } from './_shared.js';

// Renvoie les métadonnées de mise en page du PDF pré-généré (pageStarts,
// position du slot "Par :") — voir admin-pregenerate-readyfiches.js pour ce
// qu'elles contiennent, et stampReadyFichePdf() dans index.html pour leur
// usage. Même protection par achat que get-readyfiche-pdf.js.
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
    if (!isAmbassadorUser(record) && !hasReadyFichePurchase(purchases, classe, matiere)) {
      return json({ ok: false, reason: 'notpurchased' }, 403);
    }
    const key = `readyfiche-pdfs/${classe}/${matiere}.meta.json`;
    const obj = await env.FPB_IMAGES.get(key);
    if (!obj) return json({ ok: false, reason: 'notfound' }, 404);
    const meta = await obj.json();
    return json({ ok: true, meta });
  } catch (err) {
    return json({ error: 'Erreur : ' + err.message }, 500);
  }
}

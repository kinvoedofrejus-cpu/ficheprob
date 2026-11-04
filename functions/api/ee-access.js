import { json, normalizePhone, ensureDownloadTables, resolveOwner, hasResourcePurchase, EE_LIST_PRICE, eeResourceId } from './_shared.js';
import { OWNER_PHONE_HARDCODED, OWNER_CODE_HARDCODED } from './user-login.js';

// Cloudflare Function — /api/ee-access   (cahier d'expression écrite, 05/11/2026)
//
// Dit si la LISTE COMPLÈTE (une page par élève) du cahier d'expression écrite d'une classe peut être
// téléchargée sans payer :
//   - compte propriétaire : toujours (owner:true) ;
//   - achat déjà fait (500 F) pour cette classe, rattaché au compte ou à l'appareil : paid:true.
// La page unique (un seul élève ou page vierge) reste gratuite : elle ne passe pas par ici.
// Body : { phone?, code?, deviceId, classe }
export async function onRequestPost(context) {
  const { request, env } = context;
  const db = env.FPB_DB;
  try {
    const { phone, code, deviceId, classe } = await request.json();
    const cl = String(classe || '').toUpperCase();
    if (!['CE1', 'CE2', 'CM1', 'CM2'].includes(cl)) return json({ ok: false, reason: 'invalid' }, 400);

    const phoneDigits = normalizePhone(phone || '');
    const cleanCode = String(code || '').trim().toUpperCase();
    if (phoneDigits && phoneDigits === normalizePhone(OWNER_PHONE_HARDCODED) && cleanCode === OWNER_CODE_HARDCODED.toUpperCase()) {
      return json({ ok: true, owner: true, paid: true, price: EE_LIST_PRICE });
    }

    await ensureDownloadTables(db);
    const who = await resolveOwner(db, { phone, code, deviceId });
    if (!who.owner) return json({ ok: false, reason: 'device' }, 400);

    const paid = await hasResourcePurchase(db, who.owner, eeResourceId(cl));
    return json({ ok: true, owner: false, paid, price: EE_LIST_PRICE });
  } catch (err) {
    return json({ error: "Erreur lors de la vérification de l'accès : " + err.message }, 500);
  }
}

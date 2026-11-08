import { normalizePhone, json, getUser } from './_shared.js';
import { saveContact, getContact, normalizeWhatsApp, cleanEmailAddr } from './_notify.js';

/* POST /api/save-contact   { phone, code, email?, whatsapp?, optEmail?, optWhatsapp?, optPush?, source? }  (numéro + code d'accès, comme record-usage)
   - sans autre champ que phone+code : renvoie simplement le contact enregistré ;
   - sinon enregistre l'email / le numéro WhatsApp et les consentements (par défaut tout est actif ; un canal passe à 0 seulement si la personne se désinscrit).
   Réponse : { ok, contact: { email, whatsapp, optEmail, optWhatsapp, optPush } } */
const OWNER_PHONE_HARDCODED = '0166661846';
const OWNER_CODE_HARDCODED = 'KINVOS';

function view(c) {
  return c ? { email: c.email || '', whatsapp: c.whatsapp || '', optEmail: Number(c.opt_email) !== 0, optWhatsapp: Number(c.opt_whatsapp) !== 0, optPush: Number(c.opt_push) !== 0, known: true }
           : { email: '', whatsapp: '', optEmail: true, optWhatsapp: true, optPush: true, known: false };
}

export async function onRequestPost(context) {
  const { request, env } = context;
  const db = env.FPB_DB;
  try {
    const body = await request.json();
    const phone = normalizePhone(body.phone);
    const code = String(body.code || '').trim().toUpperCase();
    if (phone.length < 8 || !code) return json({ ok: false, reason: 'invalid' }, 400);

    const isOwner = phone === normalizePhone(OWNER_PHONE_HARDCODED) && code === OWNER_CODE_HARDCODED;
    if (!isOwner) {
      const u = await getUser(db, phone);
      if (!u || String(u.code || '').toUpperCase() !== code) return json({ ok: false, reason: 'invalid' }, 401);
      if (!u.active) return json({ ok: false, reason: 'inactive' }, 403);
    }

    const has = ['email', 'whatsapp', 'optEmail', 'optWhatsapp', 'optPush'].some(k => body[k] !== undefined);
    if (!has) return json({ ok: true, contact: view(await getContact(db, phone)) });

    const data = { source: String(body.source || 'app').slice(0, 20) };
    if (body.email !== undefined) {
      const e = String(body.email || '').trim();
      if (e && !cleanEmailAddr(e)) return json({ ok: false, error: "Adresse email invalide." }, 400);
      data.email = e;
    }
    if (body.whatsapp !== undefined) {
      const w = String(body.whatsapp || '').trim();
      if (w && !normalizeWhatsApp(w)) return json({ ok: false, error: "Numéro WhatsApp invalide (ex. 0197001234 ou +33612345678)." }, 400);
      data.whatsapp = w;
    }
    for (const k of ['optEmail', 'optWhatsapp', 'optPush']) if (body[k] !== undefined) data[k] = !!body[k];
    const saved = await saveContact(db, phone, data);
    return json({ ok: true, contact: view(saved) });
  } catch (err) {
    return json({ ok: false, error: 'Erreur : ' + err.message }, 500);
  }
}

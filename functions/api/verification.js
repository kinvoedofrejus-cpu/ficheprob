import { normalizePhone, json, getUser } from './_shared.js';
import {
  verifState, ensureVerifTables, cleanEmail, maskEmail, sendEmail, codeEmailHtml,
  issueCode, checkCode, issueToken, getAccountEmail, saveAccountEmail,
  whatsappEnabled, issueWaChallenge, getWaChallenge, deleteWaChallenge
} from './_verify.js';

/* Cloudflare Function — /api/verification   (code de vérification par email ; téléphone à venir)
   Body : { action, purpose, channel, phone, email?, code? }
     action 'needed' : { needed } — faut-il vérifier avant de créer ce compte ? (non si le numéro a déjà un compte, ou si l'envoi d'emails n'est pas configuré)
     action 'send'   : envoie un code. purpose 'register' (email saisi) ou 'recover' (email déjà enregistré sur le compte).
     action 'check'  : contrôle le code. register -> { token } (à renvoyer à la création du compte) ; recover -> { phone, code } (code d'accès du compte). */
export async function onRequestPost(context) {
  const { request, env } = context;
  const db = env.FPB_DB;
  try {
    const body = await request.json();
    const { action, purpose, channel } = body;
    const phone = normalizePhone(body.phone);
    if (!['register', 'recover'].includes(purpose) && action !== 'needed') return json({ ok: false, error: 'Requête invalide.' }, 400);
    if (phone.length < 8) return json({ ok: false, error: 'Numéro de téléphone invalide.' }, 400);

    if (action === 'needed') {
      const vst = await verifState(db, env);
      if (!vst.required) return json({ ok: true, needed: false });
      const existing = await getUser(db, phone);
      return json({ ok: true, needed: !existing, channels: vst.channels });
    }

    const vst = await verifState(db, env);
    if (channel === 'whatsapp' || action === 'wa_status') {
      if (!vst.channels.whatsapp) return json({ ok: false, reason: 'channel_unavailable', error: 'La vérification par WhatsApp sera bientôt disponible. Utilise ton email.' }, 400);
      await ensureVerifTables(db);
      if (action === 'send') {
        const user = await getUser(db, phone);
        if (purpose === 'register' && user) return json({ ok: true, skip: true });
        const ch = await issueWaChallenge(db, purpose, phone);
        if (!ch.ok) return json({ ok: false, reason: ch.reason, error: 'Trop de demandes. Réessaie dans une heure.' }, 429);
        const text = 'Bonjour, mon code de vérification FicheProBot : ' + ch.ref;
        return json({ ok: true, ref: ch.ref, waLink: 'https://wa.me/' + String(env.WHATSAPP_NUMBER).replace(/\D/g, '') + '?text=' + encodeURIComponent(text), expiresIn: 600 });
      }
      if (action === 'wa_status') {
        const row = await getWaChallenge(db, body.ref, purpose, phone);
        if (!row || row.expires_at < Date.now()) return json({ ok: false, reason: 'expired', error: 'La demande a expiré. Recommence.' }, 400);
        if (!row.verified_at) return json({ ok: true, verified: false });
        await deleteWaChallenge(db, row.ref);
        if (purpose === 'register') return json({ ok: true, verified: true, token: await issueToken(db, env, phone, '') });
        const user = await getUser(db, phone);
        if (!user) return json({ ok: false, reason: 'expired', error: 'Aucun compte avec ce numéro.' }, 400);
        return json({ ok: true, verified: true, phone, code: user.code });
      }
      return json({ ok: false, error: 'Action inconnue.' }, 400);
    }
    if (channel && channel !== 'email') {
      return json({ ok: false, reason: 'channel_unavailable', error: 'Canal inconnu.' }, 400);
    }
    if (!vst.channels.email) return json({ ok: false, reason: 'email_not_configured', error: "L'envoi d'emails n'est pas encore configuré." }, 503);
    await ensureVerifTables(db);

    if (action === 'send') {
      let to = '';
      if (purpose === 'register') {
        to = cleanEmail(body.email);
        if (!to) return json({ ok: false, error: 'Adresse email invalide.' }, 400);
        if (await getUser(db, phone)) return json({ ok: true, skip: true });
      } else {
        const user = await getUser(db, phone);
        if (!user) return json({ ok: true, masked: '' });   // réponse neutre : on ne révèle pas si le numéro existe
        to = await getAccountEmail(db, phone);
        if (!to) return json({ ok: false, reason: 'no_email', error: "Aucun email n'est enregistré pour ce compte. Contacte-nous pour récupérer ton code." }, 400);
      }
      const k = purpose + ':' + phone + ':' + to;
      const issued = await issueCode(db, env, k);
      if (!issued.ok) {
        const msg = issued.reason === 'too_soon' ? 'Attends ' + issued.wait + ' s avant de redemander un code.' : "Trop de demandes. Réessaie dans une heure.";
        return json({ ok: false, reason: issued.reason, wait: issued.wait, error: msg }, 429);
      }
      const sent = await sendEmail(env, to, 'Ton code de vérification FicheProBot : ' + issued.code, codeEmailHtml(issued.code, purpose));
      if (!sent.ok) return json({ ok: false, reason: sent.reason, error: "L'email n'a pas pu être envoyé. Vérifie l'adresse ou réessaie plus tard." }, 502);
      return json({ ok: true, masked: maskEmail(to) });
    }

    if (action === 'check') {
      let to = '';
      if (purpose === 'register') {
        to = cleanEmail(body.email);
        if (!to) return json({ ok: false, error: 'Adresse email invalide.' }, 400);
      } else {
        const user = await getUser(db, phone);
        to = user ? await getAccountEmail(db, phone) : '';
        if (!to) return json({ ok: false, reason: 'expired', error: 'Code expiré ou invalide.' }, 400);
      }
      const r = await checkCode(db, env, purpose + ':' + phone + ':' + to, body.code);
      if (!r.ok) {
        const msg = r.reason === 'wrong' ? 'Code incorrect (' + r.left + ' essai(s) restant(s)).'
          : r.reason === 'too_many_attempts' ? 'Trop d\'essais. Demande un nouveau code.'
          : 'Code expiré. Demande un nouveau code.';
        return json({ ok: false, reason: r.reason, error: msg }, 400);
      }
      if (purpose === 'register') return json({ ok: true, token: await issueToken(db, env, phone, to) });
      const user = await getUser(db, phone);
      return json({ ok: true, phone, code: user.code });
    }
    return json({ ok: false, error: 'Action inconnue.' }, 400);
  } catch (err) {
    return json({ ok: false, error: 'Erreur de vérification : ' + err.message }, 500);
  }
}

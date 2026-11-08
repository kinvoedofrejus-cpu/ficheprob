import { normalizePhone, json, getUser } from './_shared.js';
import { ensureNotifTables, saveContact, pushEnabled } from './_notify.js';

/* POST /api/push-subscribe   { phone, code, subscription: { endpoint, keys: { p256dh, auth } } }   ou   { phone, code, unsubscribe: true, endpoint }
   Enregistre (ou retire) l'appareil. L'abonnement push vaut consentement aux notifications push (opt_push = 1). */
const OWNER_PHONE_HARDCODED = '0166661846';
const OWNER_CODE_HARDCODED = 'KINVOS';
const MAX_DEVICES = 5;

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
    await ensureNotifTables(db);

    if (body.unsubscribe) {
      if (body.endpoint) await db.prepare('DELETE FROM push_subs WHERE endpoint = ? AND phone = ?').bind(String(body.endpoint), phone).run();
      const left = await db.prepare('SELECT COUNT(*) AS n FROM push_subs WHERE phone = ?').bind(phone).first();
      if (!left || !left.n) await saveContact(db, phone, { optPush: false });
      return json({ ok: true });
    }

    if (!pushEnabled(env)) return json({ ok: false, reason: 'push_not_configured', error: "Les notifications push ne sont pas encore activées sur le serveur." }, 503);
    const sub = body.subscription || {};
    const endpoint = String(sub.endpoint || '');
    const p256dh = String(sub.keys && sub.keys.p256dh || '');
    const auth = String(sub.keys && sub.keys.auth || '');
    if (!/^https:\/\//.test(endpoint) || endpoint.length > 1000 || !p256dh || !auth) return json({ ok: false, error: 'Abonnement invalide.' }, 400);

    const now = Date.now();
    await db.prepare(`INSERT INTO push_subs (endpoint, phone, p256dh, auth, ua, created_at) VALUES (?,?,?,?,?,?)
      ON CONFLICT(endpoint) DO UPDATE SET phone=excluded.phone, p256dh=excluded.p256dh, auth=excluded.auth, ua=excluded.ua`)
      .bind(endpoint, phone, p256dh, auth, String(request.headers.get('user-agent') || '').slice(0, 160), now).run();
    // garde seulement les 5 appareils les plus récents du compte
    await db.prepare(`DELETE FROM push_subs WHERE phone = ? AND endpoint NOT IN (SELECT endpoint FROM push_subs WHERE phone = ? ORDER BY created_at DESC LIMIT ${MAX_DEVICES})`).bind(phone, phone).run();
    await saveContact(db, phone, { optPush: true, source: 'push' });
    return json({ ok: true });
  } catch (err) {
    return json({ ok: false, error: 'Erreur : ' + err.message }, 500);
  }
}

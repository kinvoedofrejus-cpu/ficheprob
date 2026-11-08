/* Notifications (novembre 2026) : notifications push (Web Push + VAPID), emails (Resend) et messages WhatsApp (API Cloud de Meta),
   + carnet de contacts des abonnés qui ont accepté de recevoir des nouvelles.
   Tables créées à la demande (aucune migration à lancer) :
     - contacts      : un contact par compte (phone -> email, whatsapp, consentements par canal) ;
     - push_subs     : appareils abonnés aux notifications push (un compte peut avoir plusieurs appareils) ;
     - broadcasts    : historique des messages envoyés depuis l'admin ;
     - notif_log     : rappels automatiques déjà envoyés (pour ne jamais envoyer deux fois le même).
   Variables Cloudflare (secrets, jamais dans le code) :
     VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT (ex. mailto:contact@ficheprobot.site)   -> notifications push
     RESEND_API_KEY, RESEND_FROM                                                                -> emails (déjà utilisés pour la vérification)
     WHATSAPP_TOKEN, WHATSAPP_PHONE_NUMBER_ID, (WHATSAPP_TEMPLATE_NAME, WHATSAPP_TEMPLATE_LANG) -> WhatsApp
   Un canal non configuré est simplement ignoré (jamais d'erreur bloquante). */

import { sendEmail } from './_verify.js';

const SITE_URL = 'https://www.ficheprobot.site';
const WA_API_VERSION = 'v21.0';

/* ---------- Petits utilitaires ---------- */
export function b64uEncode(bytes) {
  let s = ''; const u = new Uint8Array(bytes);
  for (let i = 0; i < u.length; i++) s += String.fromCharCode(u[i]);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
export function b64uDecode(str) {
  const s = String(str).replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(s + '='.repeat((4 - (s.length % 4)) % 4));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
function concat(...arrs) {
  const out = new Uint8Array(arrs.reduce((n, a) => n + a.length, 0));
  let o = 0; for (const a of arrs) { out.set(a, o); o += a.length; }
  return out;
}
const enc = new TextEncoder();
export function escHtml(t) { return String(t == null ? '' : t).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }

export function cleanEmailAddr(e) {
  const s = String(e || '').trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(s) && s.length <= 120 ? s : '';
}

/* Numéro WhatsApp au format international sans « + » (ex. 2290166661846).
   Bénin : 10 chiffres commençant par 0 -> 229 + numéro ; 8 chiffres (ancien format) -> 22901 + numéro.
   Un numéro saisi avec « + » ou « 00 » (autre pays) est gardé tel quel. */
export function normalizeWhatsApp(input) {
  const raw = String(input || '').trim();
  let d = raw.replace(/\D/g, '');
  if (!d) return '';
  if (raw.startsWith('+')) return d.length >= 9 && d.length <= 15 ? d : '';
  if (d.startsWith('00')) d = d.slice(2);
  else if (d.startsWith('229') && d.length >= 11) { /* déjà international */ }
  else if (d.length === 10 && d.startsWith('0')) d = '229' + d;
  else if (d.length === 8) d = '22901' + d;
  else if (d.length < 11) return '';
  return d.length >= 9 && d.length <= 15 ? d : '';
}

/* ---------- Tables ---------- */
let tablesReady = false;
export async function ensureNotifTables(db) {
  if (tablesReady) return;
  await db.batch([
    db.prepare(`CREATE TABLE IF NOT EXISTS contacts (
      phone TEXT PRIMARY KEY, email TEXT, whatsapp TEXT,
      opt_email INTEGER NOT NULL DEFAULT 1, opt_whatsapp INTEGER NOT NULL DEFAULT 1, opt_push INTEGER NOT NULL DEFAULT 1,
      consent_at INTEGER, unsub_token TEXT, source TEXT, created_at INTEGER, updated_at INTEGER)`),
    db.prepare(`CREATE TABLE IF NOT EXISTS push_subs (
      endpoint TEXT PRIMARY KEY, phone TEXT NOT NULL, p256dh TEXT NOT NULL, auth TEXT NOT NULL, ua TEXT, created_at INTEGER)`),
    db.prepare('CREATE INDEX IF NOT EXISTS idx_push_subs_phone ON push_subs (phone)'),
    db.prepare(`CREATE TABLE IF NOT EXISTS broadcasts (
      id TEXT PRIMARY KEY, title TEXT, body TEXT, url TEXT, channels TEXT, audience TEXT,
      total INTEGER DEFAULT 0, push_sent INTEGER DEFAULT 0, email_sent INTEGER DEFAULT 0, wa_sent INTEGER DEFAULT 0,
      failed INTEGER DEFAULT 0, status TEXT, created_at INTEGER, finished_at INTEGER)`),
    db.prepare('CREATE TABLE IF NOT EXISTS account_emails (phone TEXT PRIMARY KEY, email TEXT NOT NULL, verified_at INTEGER)'),
    db.prepare('CREATE TABLE IF NOT EXISTS notif_log (phone TEXT NOT NULL, kind TEXT NOT NULL, ref TEXT NOT NULL, ts INTEGER, PRIMARY KEY (phone, kind, ref))')
  ]);
  tablesReady = true;
}

function randomToken() {
  const a = new Uint8Array(18); crypto.getRandomValues(a);
  return b64uEncode(a);
}

/* Enregistre (ou met à jour) le contact d'un compte. Les consentements ne sont modifiés que si le champ est fourni. */
export async function saveContact(db, phone, data) {
  await ensureNotifTables(db);
  const now = Date.now();
  const row = await db.prepare('SELECT * FROM contacts WHERE phone = ?').bind(phone).first();
  const email = data.email !== undefined ? cleanEmailAddr(data.email) : (row ? row.email : '');
  const whatsapp = data.whatsapp !== undefined ? normalizeWhatsApp(data.whatsapp) : (row ? row.whatsapp : '');
  // Tout le monde reçoit les messages par défaut (1) ; un canal ne passe à 0 que si la personne se désinscrit.
  const flag = (k, cur) => (data[k] === undefined ? (cur === undefined || cur === null ? 1 : cur) : (data[k] ? 1 : 0));
  const optEmail = flag('optEmail', row ? row.opt_email : undefined);
  const optWa = flag('optWhatsapp', row ? row.opt_whatsapp : undefined);
  const optPush = flag('optPush', row ? row.opt_push : undefined);
  const consentAt = (row && row.consent_at) || now;
  await db.prepare(`INSERT INTO contacts (phone, email, whatsapp, opt_email, opt_whatsapp, opt_push, consent_at, unsub_token, source, created_at, updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT(phone) DO UPDATE SET email=excluded.email, whatsapp=excluded.whatsapp, opt_email=excluded.opt_email,
      opt_whatsapp=excluded.opt_whatsapp, opt_push=excluded.opt_push, consent_at=excluded.consent_at, updated_at=excluded.updated_at`)
    .bind(phone, email || null, whatsapp || null, optEmail, optWa, optPush, consentAt, (row && row.unsub_token) || randomToken(),
      data.source || (row && row.source) || 'app', (row && row.created_at) || now, now).run();
  return await db.prepare('SELECT * FROM contacts WHERE phone = ?').bind(phone).first();
}
export async function getContact(db, phone) {
  await ensureNotifTables(db);
  return await db.prepare('SELECT * FROM contacts WHERE phone = ?').bind(phone).first();
}

/* ================= WEB PUSH (RFC 8291 aes128gcm + RFC 8292 VAPID), Web Crypto uniquement ================= */
export function pushEnabled(env) { return !!(env && env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY); }

async function hkdf(salt, ikm, info, length) {
  const key = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info }, key, length * 8));
}

/* Chiffre une charge utile pour un abonnement. `fixed` ({ asKeyPair, salt }) ne sert qu'aux tests (vecteur de la RFC 8291). */
export async function encryptPush(plaintext, p256dhB64u, authB64u, fixed) {
  const uaPublic = b64uDecode(p256dhB64u);
  const authSecret = b64uDecode(authB64u);
  const asKeys = (fixed && fixed.asKeyPair) || await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const asPublic = new Uint8Array(await crypto.subtle.exportKey('raw', asKeys.publicKey));
  const uaKey = await crypto.subtle.importKey('raw', uaPublic, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const ecdh = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: uaKey }, asKeys.privateKey, 256));
  const prk = await hkdf(authSecret, ecdh, concat(enc.encode('WebPush: info\0'), uaPublic, asPublic), 32);
  const salt = (fixed && fixed.salt) || crypto.getRandomValues(new Uint8Array(16));
  const cek = await hkdf(salt, prk, enc.encode('Content-Encoding: aes128gcm\0'), 16);
  const nonce = await hkdf(salt, prk, enc.encode('Content-Encoding: nonce\0'), 12);
  const data = typeof plaintext === 'string' ? enc.encode(plaintext) : plaintext;
  const padded = concat(data, new Uint8Array([2]));   // 0x02 = dernier (et seul) enregistrement
  const aes = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['encrypt']);
  const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, aes, padded));
  const rs = new Uint8Array([0, 0, 0x10, 0]);         // taille d'enregistrement 4096
  return concat(salt, rs, new Uint8Array([asPublic.length]), asPublic, cipher);
}

async function vapidAuthHeader(env, endpoint) {
  const pub = b64uDecode(env.VAPID_PUBLIC_KEY);        // 65 octets : 0x04 | x | y
  const jwk = { kty: 'EC', crv: 'P-256', x: b64uEncode(pub.slice(1, 33)), y: b64uEncode(pub.slice(33, 65)), d: env.VAPID_PRIVATE_KEY, ext: true };
  const key = await crypto.subtle.importKey('jwk', jwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  const aud = new URL(endpoint).origin;
  const head = b64uEncode(enc.encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  const claims = b64uEncode(enc.encode(JSON.stringify({ aud, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: env.VAPID_SUBJECT || 'mailto:contact@ficheprobot.site' })));
  const sig = new Uint8Array(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, enc.encode(head + '.' + claims)));
  return 'vapid t=' + head + '.' + claims + '.' + b64uEncode(sig) + ', k=' + env.VAPID_PUBLIC_KEY;
}

/* Envoie une notification à un appareil. Renvoie { ok, gone } (gone = abonnement expiré/supprimé : à effacer). */
export async function sendPushToSub(env, sub, payload, opts) {
  if (!pushEnabled(env)) return { ok: false, reason: 'push_not_configured' };
  try {
    const body = await encryptPush(JSON.stringify(payload), sub.p256dh, sub.auth);
    const res = await fetch(sub.endpoint, {
      method: 'POST',
      headers: {
        'Authorization': await vapidAuthHeader(env, sub.endpoint),
        'Content-Encoding': 'aes128gcm', 'Content-Type': 'application/octet-stream',
        'TTL': String((opts && opts.ttl) || 86400), 'Urgency': (opts && opts.urgency) || 'normal'
      },
      body
    });
    if (res.status === 404 || res.status === 410) return { ok: false, gone: true };
    return { ok: res.ok, status: res.status };
  } catch (e) { return { ok: false, reason: 'send_failed' }; }
}

/* Envoie à tous les appareils d'un compte ; efface ceux qui n'existent plus. Renvoie le nombre d'envois réussis. */
export async function sendPushToPhone(env, db, phone, payload) {
  const { results } = await db.prepare('SELECT * FROM push_subs WHERE phone = ? LIMIT 5').bind(phone).all();
  let ok = 0; const dead = [];
  for (const s of (results || [])) {
    const r = await sendPushToSub(env, s, payload);
    if (r.ok) ok++; else if (r.gone) dead.push(s.endpoint);
  }
  if (dead.length) await db.batch(dead.map(e => db.prepare('DELETE FROM push_subs WHERE endpoint = ?').bind(e)));
  return ok;
}

/* ================= EMAIL (Resend, envoi groupé : 100 messages = 1 seule requête) ================= */
export function emailEnabled(env) { return !!(env && env.RESEND_API_KEY); }

export function notifEmailHtml({ prenom, title, body, url, unsubUrl }) {
  const safeBody = escHtml(body).replace(/\n/g, '<br>');
  const link = url ? '<p style="text-align:center;margin:20px 0 4px"><a href="' + escHtml(url) + '" style="background:#1f5fbf;color:#fff;text-decoration:none;padding:12px 22px;border-radius:9px;font-weight:700;display:inline-block">Ouvrir FicheProBot</a></p>' : '';
  return '<div style="font-family:Arial,sans-serif;max-width:480px;margin:auto;border:1px solid #ddd;border-radius:12px;overflow:hidden">'
    + '<div style="background:#1f5fbf;padding:16px;text-align:center"><img src="' + SITE_URL + '/icon-192.png" width="56" height="56" alt="FicheProBot" style="display:block;margin:0 auto 6px;border-radius:12px;border:0"><div style="color:#fff;font-size:18px;font-weight:700">FicheProBot</div></div>'
    + '<div style="padding:20px;color:#222;line-height:1.55">'
    + (prenom ? '<p style="margin:0 0 10px">Bonjour ' + escHtml(prenom) + ',</p>' : '')
    + (title ? '<h2 style="margin:0 0 10px;font-size:18px">' + escHtml(title) + '</h2>' : '')
    + '<p style="margin:0">' + safeBody + '</p>' + link + '</div>'
    + '<div style="background:#f5f7fa;padding:12px 20px;font-size:11.5px;color:#777;border-top:1px solid #e3e3e3;line-height:1.6">'
    + 'Tu reçois ce message parce que tu as un compte FicheProBot. '
    + (unsubUrl ? '<a href="' + escHtml(unsubUrl) + '" style="color:#1f5fbf">Ne plus recevoir d\'emails</a>' : '')
    + '<br>KINVOS GROUP SARL</div></div>';
}

/* items : [{ to, subject, html }] (100 maximum par appel). Renvoie le nombre d'emails acceptés. */
export async function sendEmailBatch(env, items) {
  if (!emailEnabled(env) || !items.length) return 0;
  const from = env.RESEND_FROM || 'FicheProBot <onboarding@resend.dev>';
  try {
    const res = await fetch('https://api.resend.com/emails/batch', {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + env.RESEND_API_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify(items.map(i => ({ from, to: [i.to], subject: i.subject, html: i.html })))
    });
    return res.ok ? items.length : 0;
  } catch (e) { return 0; }
}

/* ================= WHATSAPP (API Cloud de Meta) ================= */
export function whatsappSendEnabled(env) { return !!(env && env.WHATSAPP_TOKEN && env.WHATSAPP_PHONE_NUMBER_ID); }

/* Hors fenêtre de 24 h après un message du destinataire, WhatsApp n'accepte QUE les modèles (templates) approuvés par Meta.
   Si WHATSAPP_TEMPLATE_NAME est définie, on envoie ce modèle avec 2 variables : {{1}} = prénom, {{2}} = message.
   Sinon on tente un message texte libre (ne passe que si la personne a écrit au numéro dans les dernières 24 h). */
export async function sendWhatsApp(env, to, prenom, text) {
  if (!whatsappSendEnabled(env)) return { ok: false, reason: 'whatsapp_not_configured' };
  const payload = env.WHATSAPP_TEMPLATE_NAME
    ? { messaging_product: 'whatsapp', to, type: 'template', template: { name: env.WHATSAPP_TEMPLATE_NAME, language: { code: env.WHATSAPP_TEMPLATE_LANG || 'fr' },
        components: [{ type: 'body', parameters: [{ type: 'text', text: String(prenom || 'enseignant').slice(0, 60) }, { type: 'text', text: String(text).replace(/\s*\n+\s*/g, ' ').slice(0, 900) }] }] } }
    : { messaging_product: 'whatsapp', to, type: 'text', text: { body: String(text).slice(0, 3800), preview_url: true } };
  try {
    const res = await fetch('https://graph.facebook.com/' + WA_API_VERSION + '/' + env.WHATSAPP_PHONE_NUMBER_ID + '/messages', {
      method: 'POST', headers: { 'Authorization': 'Bearer ' + env.WHATSAPP_TOKEN, 'Content-Type': 'application/json' }, body: JSON.stringify(payload)
    });
    return { ok: res.ok, status: res.status };
  } catch (e) { return { ok: false, reason: 'send_failed' }; }
}

export function channelsStatus(env) {
  return { push: pushEnabled(env), email: emailEnabled(env), whatsapp: whatsappSendEnabled(env), whatsappTemplate: !!(env && env.WHATSAPP_TEMPLATE_NAME) };
}

/* ================= Envoi à un lot de destinataires (utilisé par l'admin et par la tâche planifiée) =================
   recipients : lignes { phone, prenom, email, whatsapp, opt_email, opt_whatsapp, opt_push, unsub_token }
   msg : { title, body, url } ; channels : { push, email, whatsapp }
   Le texte accepte {prenom}. Renvoie { push, email, whatsapp, failed }. */
export async function deliverToRecipients(env, db, recipients, msg, channels) {
  const out = { push: 0, email: 0, whatsapp: 0, failed: 0 };
  const on = v => v === null || v === undefined || Number(v) !== 0;   // « pas désinscrit »
  const fill = (t, r) => String(t || '').replace(/\{prenom\}/gi, (r.prenom || '').trim() || 'enseignant(e)');
  const url = msg.url ? (msg.url.startsWith('http') ? msg.url : SITE_URL + (msg.url.startsWith('/') ? '' : '/') + msg.url) : SITE_URL;

  // Jeton de désinscription pour ceux qui n'ont pas encore de fiche contact (créée ici, en une seule requête D1).
  const missing = recipients.filter(r => !r.unsub_token);
  if (missing.length) {
    for (const r of missing) r.unsub_token = randomToken();
    const now = Date.now();
    await db.batch(missing.map(r => db.prepare('INSERT OR IGNORE INTO contacts (phone, email, whatsapp, unsub_token, source, created_at, updated_at) VALUES (?,?,?,?,?,?,?)')
      .bind(r.phone, null, null, r.unsub_token, 'auto', now, now)));
  }

  const emailItems = [];
  for (const r of recipients) {
    const title = fill(msg.title, r), body = fill(msg.body, r);
    if (channels.push && on(r.opt_push) && Number(r.devices || 0) > 0 && pushEnabled(env)) {
      const n = await sendPushToPhone(env, db, r.phone, { title: title || 'FicheProBot', body, url });
      if (n) out.push++;
    }
    if (channels.email && on(r.opt_email) && r.email && emailEnabled(env)) {
      const unsub = SITE_URL + '/api/notif-unsub?t=' + encodeURIComponent(r.unsub_token);
      emailItems.push({ to: r.email, subject: title || 'Nouvelles de FicheProBot', html: notifEmailHtml({ prenom: (r.prenom || '').trim(), title, body, url, unsubUrl: unsub }) });
    }
    // WhatsApp : le numéro saisi, sinon le numéro du compte (au Bénin, la plupart des numéros ont WhatsApp)
    const waTo = on(r.opt_whatsapp) ? (r.whatsapp || normalizeWhatsApp(r.phone)) : '';
    if (channels.whatsapp && waTo && whatsappSendEnabled(env)) {
      const text = (title ? title + '\n' : '') + body + (msg.url ? '\n' + url : '') + '\n\n(Pour ne plus recevoir ces messages, réponds STOP.)';
      const w = await sendWhatsApp(env, waTo, (r.prenom || '').trim(), text);
      if (w.ok) out.whatsapp++; else out.failed++;
    }
  }
  for (let i = 0; i < emailItems.length; i += 100) {
    const chunk = emailItems.slice(i, i + 100);
    const k = await sendEmailBatch(env, chunk);
    out.email += k; out.failed += chunk.length - k;
  }
  return out;
}

/* Base de requête commune (admin + rappels) : tous les comptes + contacts, avec l'email du compte (vérification) en secours. */
export const RECIPIENT_FROM = `FROM (SELECT phone FROM users UNION SELECT phone FROM contacts) p
  LEFT JOIN users u ON u.phone = p.phone LEFT JOIN contacts c ON c.phone = p.phone LEFT JOIN account_emails ae ON ae.phone = p.phone`;
export const RECIPIENT_COLS = `p.phone AS phone, u.prenom AS prenom, u.nom AS nom, COALESCE(c.email, ae.email) AS email, c.whatsapp AS whatsapp,
  c.opt_email AS opt_email, c.opt_whatsapp AS opt_whatsapp, c.opt_push AS opt_push, c.unsub_token AS unsub_token,
  (SELECT COUNT(*) FROM push_subs s WHERE s.phone = p.phone) AS devices`;

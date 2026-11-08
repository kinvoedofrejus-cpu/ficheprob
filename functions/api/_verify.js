/* Vérification par code (novembre 2026) : email via Resend ; téléphone (SMS / WhatsApp) à brancher plus tard.
   Tables créées à la demande (aucune migration) :
     - account_emails : email vérifié de chaque compte (phone -> email) ;
     - verif_codes    : codes à 6 chiffres en attente (stockés hachés, 10 min, 5 essais) ;
     - verif_tokens   : jetons à usage unique remis après un code correct (30 min), exigés pour créer un compte.
   Variables Cloudflare (secrets, jamais dans le code) : RESEND_API_KEY, RESEND_FROM (ex. « FicheProBot <noreply@tondomaine.com> »).
   Tant que RESEND_API_KEY est absente, la vérification n'est PAS exigée (aucun blocage). VERIF_REQUIRED=off la désactive. */

import { getVerifSettings } from './_shared.js';

export const VERIF_CODE_TTL_MS = 10 * 60 * 1000;
export const VERIF_TOKEN_TTL_MS = 30 * 60 * 1000;
export const VERIF_MAX_ATTEMPTS = 5;
export const VERIF_RESEND_DELAY_MS = 60 * 1000;
export const VERIF_MAX_SENDS_PER_HOUR = 5;

/* Vérification par WhatsApp : l'utilisateur envoie lui-même un message à ton numéro WhatsApp Business (WHATSAPP_NUMBER) ;
   le webhook Meta (/api/whatsapp-webhook) reconnaît le numéro de l'expéditeur. Aucun message n'est envoyé par l'application. */
export function whatsappEnabled(env) {
  return !!(env && env.WHATSAPP_NUMBER && env.WHATSAPP_APP_SECRET && env.WHATSAPP_VERIFY_TOKEN);
}
/* État effectif de la vérification : interrupteurs de l'admin (verif_settings) ET clés présentes dans Cloudflare. */
export async function verifState(db, env) {
  const vs = await getVerifSettings(db);
  const email = !!(vs.email && env && env.RESEND_API_KEY);
  const whatsapp = !!(vs.whatsapp && whatsappEnabled(env));
  const required = !!(vs.required && (email || whatsapp)) && String((env && env.VERIF_REQUIRED) || '').toLowerCase() !== 'off';
  return { required, channels: { email, whatsapp }, settings: vs, configured: { email: !!(env && env.RESEND_API_KEY), whatsapp: whatsappEnabled(env) } };
}

export async function ensureVerifTables(db) {
  await db.prepare('CREATE TABLE IF NOT EXISTS account_emails (phone TEXT PRIMARY KEY, email TEXT NOT NULL, verified_at INTEGER)').run();
  await db.prepare('CREATE TABLE IF NOT EXISTS verif_codes (k TEXT PRIMARY KEY, code_hash TEXT, expires_at INTEGER, attempts INTEGER DEFAULT 0, sent_count INTEGER DEFAULT 0, window_start INTEGER, last_sent INTEGER)').run();
  await db.prepare('CREATE TABLE IF NOT EXISTS wa_challenges (ref TEXT PRIMARY KEY, purpose TEXT, phone TEXT, created_at INTEGER, expires_at INTEGER, verified_at INTEGER)').run();
  await db.prepare('CREATE TABLE IF NOT EXISTS verif_tokens (token_hash TEXT PRIMARY KEY, phone TEXT, email TEXT, expires_at INTEGER)').run();
}

async function sha256Hex(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
}
export function hashCode(env, k, code) { return sha256Hex((env.VERIF_SALT || 'fpb') + ':' + k + ':' + code); }

export function randomSixDigits() {
  const a = new Uint32Array(1);
  const limit = 4294000000; // multiple de 10^6 pour éviter tout biais
  do { crypto.getRandomValues(a); } while (a[0] >= limit);
  return String(a[0] % 1000000).padStart(6, '0');
}
export function randomTokenHex() {
  const a = new Uint8Array(24);
  crypto.getRandomValues(a);
  return [...a].map(b => b.toString(16).padStart(2, '0')).join('');
}

export function cleanEmail(e) {
  const s = String(e || '').trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(s) && s.length <= 120 ? s : '';
}
export function maskEmail(e) {
  const [u, d] = String(e).split('@');
  if (!d) return '';
  return (u.length <= 2 ? u[0] + '*' : u.slice(0, 2) + '***') + '@' + d;
}

export async function sendEmail(env, to, subject, html) {
  if (!env.RESEND_API_KEY) return { ok: false, reason: 'email_not_configured' };
  const from = env.RESEND_FROM || 'FicheProBot <onboarding@resend.dev>';
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + env.RESEND_API_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from, to: [to], subject, html })
    });
    if (!res.ok) {
      let msg = ''; try { msg = (await res.json()).message || ''; } catch (e) {}
      return { ok: false, reason: 'send_failed', detail: msg };
    }
    return { ok: true };
  } catch (e) { return { ok: false, reason: 'send_failed' }; }
}

/* Email du code : logo + coordonnées. Variables Cloudflare facultatives (texte simple) :
   CONTACT_WHATSAPP (ex. 22901XXXXXXXX), CONTACT_PHONE (ex. +229 01 XX XX XX XX), CONTACT_EMAIL (ex. contact@tondomaine.com).
   Valeurs par défaut en dur ci-dessous ; une variable Cloudflare du même nom les remplace. */
const SITE_URL = 'https://www.ficheprobot.site';
const FACEBOOK_URL = 'https://www.facebook.com/share/195WW8t3bp/';
function escHtml(t) { return String(t).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }
export function codeEmailHtml(code, purpose, env) {
  const what = purpose === 'recover' ? 'récupérer ton code d\'accès' : 'créer ton compte';
  const e = Object.assign({ CONTACT_WHATSAPP: '2290166661846', CONTACT_PHONE: '+229 01 66 66 18 46', CONTACT_EMAIL: 'contact@ficheprobot.site' }, env || {});
  const lines = [];
  const wa = String(e.CONTACT_WHATSAPP || '').replace(/\D/g, '');
  if (wa) lines.push('WhatsApp : <a href="https://wa.me/' + wa + '" style="color:#1f5fbf;text-decoration:none">+' + wa + '</a>');
  if (e.CONTACT_PHONE) lines.push('Téléphone : ' + escHtml(e.CONTACT_PHONE));
  if (e.CONTACT_EMAIL) lines.push('Email : <a href="mailto:' + escHtml(e.CONTACT_EMAIL) + '" style="color:#1f5fbf;text-decoration:none">' + escHtml(e.CONTACT_EMAIL) + '</a>');
  lines.push('Site : <a href="' + SITE_URL + '" style="color:#1f5fbf;text-decoration:none">www.ficheprobot.site</a>');
  lines.push('<a href="' + FACEBOOK_URL + '" style="color:#1f5fbf;text-decoration:none">Notre page Facebook</a>');
  return '<div style="font-family:Arial,sans-serif;max-width:440px;margin:auto;border:1px solid #ddd;border-radius:12px;overflow:hidden">'
    + '<div style="background:#1f5fbf;padding:18px;text-align:center">'
    + '<img src="' + SITE_URL + '/icon-192.png" width="64" height="64" alt="FicheProBot" style="display:block;margin:0 auto 8px;border-radius:14px;border:0">'
    + '<div style="color:#fff;font-size:20px;font-weight:700">FicheProBot</div></div>'
    + '<div style="padding:20px">'
    + '<p style="margin:0 0 6px">Voici ton code de vérification pour ' + what + ' :</p>'
    + '<p style="font-size:32px;font-weight:700;letter-spacing:8px;text-align:center;margin:18px 0">' + code + '</p>'
    + '<p style="color:#666;font-size:13px;margin:0">Ce code est valable 10 minutes. Si tu n\'as rien demandé, ignore ce message.</p></div>'
    + '<div style="background:#f5f7fa;padding:14px 20px;font-size:12.5px;color:#444;line-height:1.7;border-top:1px solid #e3e3e3">'
    + '<b>Une question ? Contacte-nous</b><br>' + lines.join('<br>')
    + '<div style="margin-top:8px;color:#888;font-size:11.5px">KINVOS GROUP SARL · IFU 3202276043147 · RCCM RB/PNO/22 B 3921</div></div></div>';
}

/* Enregistre un code pour la clé k et renvoie le code en clair (ou une erreur de limite d'envoi). */
export async function issueCode(db, env, k) {
  const now = Date.now();
  const row = await db.prepare('SELECT * FROM verif_codes WHERE k = ?').bind(k).first();
  let sentCount = 1, windowStart = now;
  if (row) {
    if (now - (row.last_sent || 0) < VERIF_RESEND_DELAY_MS) {
      return { ok: false, reason: 'too_soon', wait: Math.ceil((VERIF_RESEND_DELAY_MS - (now - row.last_sent)) / 1000) };
    }
    if (now - (row.window_start || 0) < 3600000) {
      if ((row.sent_count || 0) >= VERIF_MAX_SENDS_PER_HOUR) return { ok: false, reason: 'too_many' };
      sentCount = (row.sent_count || 0) + 1; windowStart = row.window_start;
    }
  }
  const code = randomSixDigits();
  const h = await hashCode(env, k, code);
  await db.prepare(`INSERT INTO verif_codes (k, code_hash, expires_at, attempts, sent_count, window_start, last_sent) VALUES (?,?,?,?,?,?,?)
    ON CONFLICT(k) DO UPDATE SET code_hash=excluded.code_hash, expires_at=excluded.expires_at, attempts=0, sent_count=excluded.sent_count, window_start=excluded.window_start, last_sent=excluded.last_sent`)
    .bind(k, h, now + VERIF_CODE_TTL_MS, 0, sentCount, windowStart, now).run();
  return { ok: true, code };
}

/* Contrôle un code saisi. Compte chaque essai ; au-delà de 5, le code est invalidé. */
export async function checkCode(db, env, k, code) {
  const row = await db.prepare('SELECT * FROM verif_codes WHERE k = ?').bind(k).first();
  if (!row || row.expires_at < Date.now()) return { ok: false, reason: 'expired' };
  if ((row.attempts || 0) >= VERIF_MAX_ATTEMPTS) return { ok: false, reason: 'too_many_attempts' };
  await db.prepare('UPDATE verif_codes SET attempts = attempts + 1 WHERE k = ?').bind(k).run();
  const h = await hashCode(env, k, String(code || '').trim());
  if (h !== row.code_hash) return { ok: false, reason: 'wrong', left: Math.max(0, VERIF_MAX_ATTEMPTS - (row.attempts || 0) - 1) };
  await db.prepare('DELETE FROM verif_codes WHERE k = ?').bind(k).run();
  return { ok: true };
}

export async function issueToken(db, env, phone, email) {
  const token = randomTokenHex();
  await db.prepare('INSERT INTO verif_tokens (token_hash, phone, email, expires_at) VALUES (?,?,?,?)')
    .bind(await hashCode(env, 'token', token), phone, email, Date.now() + VERIF_TOKEN_TTL_MS).run();
  return token;
}
/* Renvoie { email } (email vide si vérifié par WhatsApp) pour un jeton valable pour ce numéro, sans le consommer ; sinon null. */
export async function peekToken(db, env, token, phone) {
  if (!token) return null;
  const row = await db.prepare('SELECT * FROM verif_tokens WHERE token_hash = ?').bind(await hashCode(env, 'token', String(token))).first();
  if (!row || row.expires_at < Date.now() || row.phone !== phone) return null;
  return { email: row.email || '' };
}
export async function consumeToken(db, env, token) {
  await db.prepare('DELETE FROM verif_tokens WHERE token_hash = ?').bind(await hashCode(env, 'token', String(token))).run();
}

export async function getAccountEmail(db, phone) {
  const row = await db.prepare('SELECT email FROM account_emails WHERE phone = ?').bind(phone).first();
  return row ? row.email : '';
}
export async function saveAccountEmail(db, phone, email, overwrite = true) {
  if (!email) return;
  if (overwrite) {
    await db.prepare('INSERT INTO account_emails (phone, email, verified_at) VALUES (?,?,?) ON CONFLICT(phone) DO UPDATE SET email=excluded.email, verified_at=excluded.verified_at')
      .bind(phone, email, Date.now()).run();
  } else {
    await db.prepare('INSERT OR IGNORE INTO account_emails (phone, email, verified_at) VALUES (?,?,?)').bind(phone, email, Date.now()).run();
  }
}

/* Garde commune aux créations de compte : renvoie { ok:true, email? } ou { ok:false, response } à renvoyer tel quel. */
export async function requireVerifiedForNewAccount(db, env, phone, token, existingUser) {
  if (existingUser || !(await verifState(db, env)).required) return { ok: true, email: '' };
  await ensureVerifTables(db);
  const found = await peekToken(db, env, token, phone);
  if (!found) return { ok: false };
  return { ok: true, email: found.email, token };
}

/* ---------- WhatsApp : défi « envoie ce message » ---------- */
export const WA_TTL_MS = 10 * 60 * 1000;
export const WA_MAX_PER_HOUR = 5;
export function last8(p) { return String(p || '').replace(/\D/g, '').slice(-8); }

export async function issueWaChallenge(db, purpose, phone) {
  const now = Date.now();
  const c = await db.prepare('SELECT COUNT(*) AS n FROM wa_challenges WHERE phone = ? AND created_at > ?').bind(phone, now - 3600000).first();
  if (c && c.n >= WA_MAX_PER_HOUR) return { ok: false, reason: 'too_many' };
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = new Uint8Array(6); crypto.getRandomValues(bytes);
  const ref = 'FPB-' + [...bytes].map(b => alphabet[b % alphabet.length]).join('');
  await db.prepare('DELETE FROM wa_challenges WHERE expires_at < ?').bind(now - 3600000).run();
  await db.prepare('INSERT INTO wa_challenges (ref, purpose, phone, created_at, expires_at, verified_at) VALUES (?,?,?,?,?,NULL)').bind(ref, purpose, phone, now, now + WA_TTL_MS).run();
  return { ok: true, ref };
}
/* Appelée par le webhook : marque le défi comme vérifié si le message vient bien du numéro attendu. */
export async function markWaVerified(db, fromDigits, ref) {
  const row = await db.prepare('SELECT * FROM wa_challenges WHERE ref = ?').bind(ref).first();
  if (!row || row.verified_at || row.expires_at < Date.now()) return false;
  if (last8(fromDigits) !== last8(row.phone) || last8(row.phone).length < 8) return false;
  await db.prepare('UPDATE wa_challenges SET verified_at = ? WHERE ref = ?').bind(Date.now(), ref).run();
  return true;
}
export async function getWaChallenge(db, ref, purpose, phone) {
  const row = await db.prepare('SELECT * FROM wa_challenges WHERE ref = ?').bind(String(ref || '').toUpperCase()).first();
  if (!row || row.purpose !== purpose || row.phone !== phone) return null;
  return row;
}
export async function deleteWaChallenge(db, ref) {
  await db.prepare('DELETE FROM wa_challenges WHERE ref = ?').bind(ref).run();
}

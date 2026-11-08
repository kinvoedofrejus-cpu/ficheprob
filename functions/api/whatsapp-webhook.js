import { ensureVerifTables, markWaVerified, whatsappEnabled, last8 } from './_verify.js';
import { ensureNotifTables } from './_notify.js';

/* Cloudflare Function — /api/whatsapp-webhook   (vérification par WhatsApp, API Cloud de Meta)
   - GET  : vérification du webhook par Meta (hub.verify_token = WHATSAPP_VERIFY_TOKEN) ;
   - POST : messages reçus. Si un message contient une référence « FPB-XXXXXX » créée par l'application et vient du bon numéro,
            le défi est marqué vérifié. L'application N'ENVOIE AUCUN message en retour.
   La signature X-Hub-Signature-256 est contrôlée avec WHATSAPP_APP_SECRET (secret de l'application Meta). */
async function hmacHex(secret, text) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(text));
  return [...new Uint8Array(sig)].map(b => b.toString(16).padStart(2, '0')).join('');
}
function safeEqual(a, b) {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

export async function onRequestGet(context) {
  const { request, env } = context;
  const u = new URL(request.url);
  if (u.searchParams.get('hub.mode') === 'subscribe' && env.WHATSAPP_VERIFY_TOKEN && u.searchParams.get('hub.verify_token') === env.WHATSAPP_VERIFY_TOKEN) {
    return new Response(u.searchParams.get('hub.challenge') || '', { status: 200 });
  }
  return new Response('Forbidden', { status: 403 });
}

export async function onRequestPost(context) {
  const { request, env } = context;
  if (!whatsappEnabled(env)) return new Response('Not configured', { status: 503 });
  const raw = await request.text();
  const sig = (request.headers.get('x-hub-signature-256') || '').replace('sha256=', '');
  if (!sig || !safeEqual(sig, await hmacHex(env.WHATSAPP_APP_SECRET, raw))) return new Response('Bad signature', { status: 401 });
  try {
    const body = JSON.parse(raw);
    const db = env.FPB_DB;
    await ensureVerifTables(db);
    for (const entry of body.entry || []) {
      for (const ch of entry.changes || []) {
        for (const m of (ch.value && ch.value.messages) || []) {
          const text = m.type === 'text' && m.text ? String(m.text.body || '') : '';
          const found = text.toUpperCase().match(/FPB-[A-HJ-NP-Z2-9]{6}/);
          if (found && m.from) await markWaVerified(db, String(m.from), found[0]);
          // Désinscription : « STOP » (ou ARRÊT / DESABONNER) envoyé par la personne coupe les messages WhatsApp de FicheProBot.
          if (m.from && /^\s*(stop|arr[eê]t|arret|d[eé]sabonner|desabonner|unsubscribe)\s*[.!]*\s*$/i.test(text)) {
            await ensureNotifTables(db);
            await db.prepare('UPDATE contacts SET opt_whatsapp = 0, updated_at = ? WHERE whatsapp IS NOT NULL AND substr(whatsapp, -8) = ?').bind(Date.now(), last8(String(m.from))).run();
          }
        }
      }
    }
  } catch (e) { /* on répond toujours 200 pour éviter les renvois en boucle de Meta */ }
  return new Response('ok', { status: 200 });
}

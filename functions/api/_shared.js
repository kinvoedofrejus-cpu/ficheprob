/*
  Fonctions partagées à toutes les fonctions Cloudflare Pages (dossier functions/api/).
  Ce fichier commence par "_" donc Cloudflare ne le traite PAS comme une route.
*/

export const PLANS = [
  { days: 7,   label: '7 jours',   quota: 70,   amount: 500 },
  { days: 30,  label: '30 jours',  quota: 270,  amount: 1500 },
  { days: 90,  label: '90 jours',  quota: 750,  amount: 2500 },
  { days: 270, label: '270 jours', quota: 2500, amount: 5000 }
];

export const CODE_CHARS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';

export function normalizePhone(phone) {
  return (phone || '').replace(/\D/g, '');
}

export function randomCode(len) {
  let s = '';
  for (let i = 0; i < len; i++) s += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
  return s;
}

export function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
  });
}

/* ---------- HMAC (Web Crypto — disponible nativement dans Cloudflare Workers) ---------- */

async function hmacKey(secret) {
  const enc = new TextEncoder();
  return crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
}

async function hmacHex(secret, message) {
  const enc = new TextEncoder();
  const key = await hmacKey(secret);
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(message));
  return [...new Uint8Array(sig)].map(b => b.toString(16).padStart(2, '0')).join('');
}

async function hmacBase64(secret, message) {
  const enc = new TextEncoder();
  const key = await hmacKey(secret);
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(message));
  return btoa(String.fromCharCode(...new Uint8Array(sig)));
}

function base64urlEncode(str) {
  return btoa(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function base64urlDecode(str) {
  str = str.replace(/-/g, '+').replace(/_/g, '/');
  while (str.length % 4) str += '=';
  return atob(str);
}

function getSessionSecret(env) {
  return env.ADMIN_SESSION_SECRET || `${env.ADMIN_EMAIL || ''}|${env.ADMIN_PASSWORD || ''}`;
}

export async function signToken(env, payload) {
  const secret = getSessionSecret(env);
  const body = base64urlEncode(JSON.stringify(payload));
  const sig = await hmacHex(secret, body);
  return `${body}.${sig}`;
}

export async function verifyToken(env, token) {
  if (!token) return null;
  const parts = String(token).split('.');
  if (parts.length !== 2) return null;
  const [body, sig] = parts;
  const secret = getSessionSecret(env);
  const expected = await hmacHex(secret, body);
  if (sig !== expected) return null;
  try {
    const payload = JSON.parse(base64urlDecode(body));
    if (payload.exp && payload.exp < Date.now()) return null;
    return payload;
  } catch (e) {
    return null;
  }
}

export async function requireAdmin(env, token) {
  const payload = await verifyToken(env, token);
  return !!(payload && payload.role === 'admin');
}

/* Vérifie la signature du webhook FedaPay (HMAC-SHA256 du corps brut).
   On ne connaît pas avec certitude si FedaPay encode en hex ou en base64,
   ni si un préfixe "sha256=" est utilisé : on accepte les variantes courantes. */
export async function verifyFedaPaySignature(secret, rawBody, headerSig) {
  if (!headerSig) return false;
  const clean = headerSig.replace(/^sha256=/i, '').trim();
  const [hex, b64] = await Promise.all([hmacHex(secret, rawBody), hmacBase64(secret, rawBody)]);
  return clean === hex || clean === b64;
}

/* ---------- Promotions programmées ---------- */
/* Stockées comme une liste sous une seule clé KV 'promo:list'.
   Chaque promo : { id, planIndex, startAt, endAt|null, message, enabled, createdAt }
   Une promo est "active maintenant" si enabled !== false ET startAt <= now ET (endAt est vide OU endAt > now). */
export const PROMO_LIST_KEY = 'promo:list';

export async function getPromoList(kv) {
  const raw = await kv.get(PROMO_LIST_KEY);
  return raw ? JSON.parse(raw) : [];
}

export async function savePromoList(kv, list) {
  await kv.put(PROMO_LIST_KEY, JSON.stringify(list));
}

export function findActivePromo(list, now = Date.now()) {
  const candidates = (list || []).filter(p =>
    p.enabled !== false &&
    p.startAt <= now &&
    (!p.endAt || p.endAt > now)
  );
  if (!candidates.length) return null;
  // s'il y en a plusieurs, on prend la plus récemment créée
  candidates.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  return candidates[0];
}

/* ---------- Résumés de cours ---------- */
/* Stockés comme une liste sous une seule clé KV 'resume:list'.
   Chaque résumé : { id, matiere, classe, titre, texte, imageKey|null, createdAt, updatedAt } */
export const RESUME_LIST_KEY = 'resume:list';

export async function getResumeList(kv) {
  const raw = await kv.get(RESUME_LIST_KEY);
  return raw ? JSON.parse(raw) : [];
}

export async function saveResumeList(kv, list) {
  await kv.put(RESUME_LIST_KEY, JSON.stringify(list));
}

/* ---------- Résumés : téléchargement gratuit limité + achat d'une matière complète ----------
   - Téléchargement gratuit d'un résumé à l'unité : limité à RESUME_FREE_DOWNLOAD_LIMIT par
     fenêtre glissante de RESUME_FREE_DOWNLOAD_WINDOW_MS (7 jours), par compte (téléphone).
     Historique stocké sous 'resumedl:<phone>' = tableau de timestamps (ms).
   - Achat d'une matière complète (toute une classe+matière) : débloque le téléchargement
     illimité pour cette matière. Stocké sous 'resumebuy:<phone>' = tableau
     [{ classe, matiere, purchasedAt, txId }]. La lecture à l'écran et la copie du texte
     restent toujours illimitées, quel que soit l'état d'achat. */
export const RESUME_BUNDLE_PRICE = 1000; // FCFA, par matière
export const RESUME_FREE_DOWNLOAD_LIMIT = 5;
export const RESUME_FREE_DOWNLOAD_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

export function kvKeyResumeDownloads(phone) { return `resumedl:${phone}`; }
export function kvKeyResumePurchases(phone) { return `resumebuy:${phone}`; }

export async function getResumePurchases(kv, phone) {
  const raw = await kv.get(kvKeyResumePurchases(phone));
  return raw ? JSON.parse(raw) : [];
}

export function hasResumePurchase(list, classe, matiere) {
  return (list || []).some(p => p.classe === classe && p.matiere === matiere);
}

export async function addResumePurchase(kv, phone, classe, matiere, txId) {
  const list = await getResumePurchases(kv, phone);
  if (!hasResumePurchase(list, classe, matiere)) {
    list.push({ classe, matiere, purchasedAt: Date.now(), txId });
    await kv.put(kvKeyResumePurchases(phone), JSON.stringify(list));
  }
  return list;
}

/* ---------- Accès KV ---------- */
/* Un seul namespace KV (lié dans Cloudflare sous le nom FPB_KV), avec des clés préfixées. */
export function kvKeyUser(phone) { return `user:${phone}`; }
export function kvKeyCode(code) { return `code:${code}`; }
export function kvKeyTx(id) { return `tx:${id}`; }

export async function kvGetJSON(kv, key) {
  const raw = await kv.get(key);
  return raw ? JSON.parse(raw) : null;
}
export async function kvSetJSON(kv, key, value) {
  await kv.put(key, JSON.stringify(value));
}
export async function kvDelete(kv, key) {
  await kv.delete(key);
}
export async function kvListByPrefix(kv, prefix) {
  const keys = [];
  let cursor;
  do {
    const res = await kv.list({ prefix, cursor });
    keys.push(...res.keys.map(k => k.name));
    cursor = res.cursor;
    if (res.list_complete) break;
  } while (cursor);
  return keys;
}

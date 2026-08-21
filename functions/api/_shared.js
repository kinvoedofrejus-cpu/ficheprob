/*
  Fonctions partagées à toutes les fonctions Cloudflare Pages (dossier functions/api/).
  Ce fichier commence par "_" donc Cloudflare ne le traite PAS comme une route.

  Stockage : base D1 (SQL), liée sous le nom FPB_DB (voir wrangler.toml).
  Les images restent dans R2 (FPB_IMAGES), inchangé.
*/

/* ---------- Identifiants admin & clés FedaPay (en dur, pas besoin de les
   configurer dans les variables d'environnement Cloudflare) ---------- */
export const ADMIN_EMAIL_HARDCODED = 'kinvoedofrejus@gmail.com';
export const ADMIN_PASSWORD_HARDCODED = '1996';
export const FEDAPAY_SECRET_KEY_HARDCODED = 'sk_live_l3GUpcaOycWM6WS9tB1LsIz_';
export const FEDAPAY_WEBHOOK_SECRET_HARDCODED = 'wh_live_JNTJ0djUKMOgccV0BqQPfGgZ';

export const PLANS = [
  { days: 7,   label: '7 jours',   quota: 70,   amount: 500 },
  { days: 30,  label: '30 jours',  quota: 270,  amount: 1000 },
  { days: 90,  label: '90 jours',  quota: 750,  amount: 1500 },
  { days: 300, label: '300 jours', quota: 2500, amount: 5000 }
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
  return env.ADMIN_SESSION_SECRET || `${ADMIN_EMAIL_HARDCODED}|${ADMIN_PASSWORD_HARDCODED}`;
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

/* =========================================================================
   UTILISATEURS (table "users")
   ========================================================================= */

function rowToUser(row) {
  if (!row) return null;
  return {
    phone: row.phone,
    nom: row.nom,
    prenom: row.prenom || '',
    code: row.code,
    planIndex: row.plan_index,
    planLabel: row.plan_label,
    classe: row.classe || null,
    expiryTs: row.expiry_ts,
    quotaTotal: row.quota_total,
    quotaUsed: row.quota_used || 0,
    active: !!row.active,
    history: row.history ? JSON.parse(row.history) : [],
    promo: row.promo ? JSON.parse(row.promo) : null,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

export async function getUser(db, phone) {
  const row = await db.prepare('SELECT * FROM users WHERE phone = ?').bind(phone).first();
  return rowToUser(row);
}

export async function getUserByCode(db, code) {
  const row = await db.prepare('SELECT * FROM users WHERE code = ?').bind(code).first();
  return rowToUser(row);
}

export async function upsertUser(db, u) {
  await db.prepare(`
    INSERT INTO users (phone, nom, prenom, code, plan_index, plan_label, classe, expiry_ts, quota_total, quota_used, active, history, promo, created_at, updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT(phone) DO UPDATE SET
      nom=excluded.nom, prenom=excluded.prenom, code=excluded.code, plan_index=excluded.plan_index,
      plan_label=excluded.plan_label, classe=excluded.classe, expiry_ts=excluded.expiry_ts,
      quota_total=excluded.quota_total, quota_used=excluded.quota_used, active=excluded.active,
      history=excluded.history, promo=excluded.promo, updated_at=excluded.updated_at
  `).bind(
    u.phone, u.nom, u.prenom || '', u.code || null, u.planIndex, u.planLabel, u.classe || null,
    u.expiryTs, u.quotaTotal, u.quotaUsed || 0, u.active ? 1 : 0,
    JSON.stringify(u.history || []), u.promo ? JSON.stringify(u.promo) : null,
    u.createdAt, u.updatedAt
  ).run();
  return u;
}

export async function deleteUser(db, phone) {
  await db.prepare('DELETE FROM users WHERE phone = ?').bind(phone).run();
}

/* Change la clé primaire (téléphone) d'un compte existant : on ne peut pas faire
   d'UPDATE de la clé primaire proprement en gardant les FK, donc on supprime puis
   réinsère avec le nouveau numéro. */
export async function renameUserPhone(db, oldPhone, newPhone) {
  const u = await getUser(db, oldPhone);
  if (!u) return null;
  u.phone = newPhone;
  await deleteUser(db, oldPhone);
  await upsertUser(db, u);
  return u;
}

export async function listUsers(db) {
  const { results } = await db.prepare('SELECT * FROM users ORDER BY updated_at DESC').all();
  return (results || []).map(rowToUser);
}

/* Génère un code d'accès unique (non déjà utilisé par un autre compte). */
export async function generateUniqueCode(db, len = 8) {
  for (let i = 0; i < 5; i++) {
    const candidate = randomCode(len);
    const taken = await getUserByCode(db, candidate);
    if (!taken) return candidate;
  }
  return null;
}

/* =========================================================================
   TRANSACTIONS (table "transactions")
   ========================================================================= */

function rowToTx(row) {
  if (!row) return null;
  return {
    id: row.id,
    type: row.type || 'subscription',
    source: row.source,
    status: row.status,
    planIndex: row.plan_index,
    phone: row.phone,
    nom: row.nom,
    prenom: row.prenom,
    amount: row.amount,
    code: row.code,
    classe: row.classe,
    matiere: row.matiere,
    tier: row.tier,
    paidAt: row.paid_at,
    createdAt: row.created_at
  };
}

export async function getTx(db, id) {
  const row = await db.prepare('SELECT * FROM transactions WHERE id = ?').bind(String(id)).first();
  return rowToTx(row);
}

export async function upsertTx(db, id, t) {
  await db.prepare(`
    INSERT INTO transactions (id, type, source, status, plan_index, phone, nom, prenom, amount, code, classe, matiere, tier, paid_at, created_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT(id) DO UPDATE SET
      type=excluded.type, source=excluded.source, status=excluded.status, plan_index=excluded.plan_index,
      phone=excluded.phone, nom=excluded.nom, prenom=excluded.prenom, amount=excluded.amount, code=excluded.code,
      classe=excluded.classe, matiere=excluded.matiere, tier=excluded.tier, paid_at=excluded.paid_at
  `).bind(
    String(id), t.type || 'subscription', t.source || null, t.status || null, t.planIndex ?? null,
    t.phone || null, t.nom || null, t.prenom || null, t.amount ?? null, t.code || null,
    t.classe || null, t.matiere || null, t.tier || null, t.paidAt ?? null, t.createdAt ?? Date.now()
  ).run();
}

export async function listTx(db) {
  const { results } = await db.prepare('SELECT * FROM transactions ORDER BY created_at DESC').all();
  return (results || []).map(rowToTx);
}

/* =========================================================================
   PROMOTIONS PROGRAMMÉES (table "promos")
   ========================================================================= */

function rowToPromo(row) {
  return {
    id: row.id,
    planIndex: row.plan_index,
    startAt: row.start_at,
    endAt: row.end_at,
    message: row.message || '',
    enabled: !!row.enabled,
    createdAt: row.created_at
  };
}

export async function listPromos(db) {
  const { results } = await db.prepare('SELECT * FROM promos ORDER BY created_at DESC').all();
  return (results || []).map(rowToPromo);
}

export async function insertPromo(db, p) {
  await db.prepare(`
    INSERT INTO promos (id, plan_index, start_at, end_at, message, enabled, created_at)
    VALUES (?,?,?,?,?,?,?)
  `).bind(p.id, p.planIndex, p.startAt, p.endAt || null, p.message || '', p.enabled === false ? 0 : 1, p.createdAt).run();
}

export async function deletePromo(db, id) {
  const res = await db.prepare('DELETE FROM promos WHERE id = ?').bind(id).run();
  return res.meta && res.meta.changes > 0;
}

export function findActivePromo(list, now = Date.now()) {
  const candidates = (list || []).filter(p =>
    p.enabled !== false &&
    p.startAt <= now &&
    (!p.endAt || p.endAt > now)
  );
  if (!candidates.length) return null;
  candidates.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  return candidates[0];
}

/* =========================================================================
   RÉSUMÉS DE COURS (table "resumes")
   ========================================================================= */

function rowToResume(row) {
  return {
    id: row.id,
    matiere: row.matiere,
    classe: row.classe,
    unite: row.unite || '',
    sa: row.sa || '',
    sequence: row.sequence || '',
    dossier: row.dossier || '',
    titre: row.titre,
    texte: row.texte,
    images: row.images ? JSON.parse(row.images) : [],
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

export async function listResumes(db) {
  const { results } = await db.prepare('SELECT * FROM resumes ORDER BY updated_at DESC').all();
  return (results || []).map(rowToResume);
}

export async function getResume(db, id) {
  const row = await db.prepare('SELECT * FROM resumes WHERE id = ?').bind(id).first();
  return rowToResume(row);
}

export async function upsertResume(db, r) {
  await db.prepare(`
    INSERT INTO resumes (id, matiere, classe, unite, sa, sequence, dossier, titre, texte, images, created_at, updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT(id) DO UPDATE SET
      matiere=excluded.matiere, classe=excluded.classe, unite=excluded.unite, sa=excluded.sa,
      sequence=excluded.sequence, dossier=excluded.dossier, titre=excluded.titre, texte=excluded.texte,
      images=excluded.images, updated_at=excluded.updated_at
  `).bind(
    r.id, r.matiere, r.classe, r.unite || '', r.sa || '', r.sequence || '', r.dossier || '',
    r.titre, r.texte, JSON.stringify(r.images || []), r.createdAt, r.updatedAt
  ).run();
  return r;
}

export async function deleteResume(db, id) {
  const row = await db.prepare('SELECT * FROM resumes WHERE id = ?').bind(id).first();
  if (!row) return null;
  await db.prepare('DELETE FROM resumes WHERE id = ?').bind(id).run();
  return rowToResume(row);
}

/* ---------- Matières masquées (par classe) pour les résumés (table "hidden_matieres") ---------- */

export function hiddenMatiereKey(classe, matiere) {
  return `${classe}::${matiere}`;
}

export async function getHiddenMatieres(db) {
  const { results } = await db.prepare('SELECT classe, matiere FROM hidden_matieres').all();
  return (results || []).map(r => hiddenMatiereKey(r.classe, r.matiere));
}

export async function setHiddenMatiere(db, classe, matiere, hidden) {
  if (hidden) {
    await db.prepare('INSERT OR IGNORE INTO hidden_matieres (classe, matiere) VALUES (?,?)').bind(classe, matiere).run();
  } else {
    await db.prepare('DELETE FROM hidden_matieres WHERE classe = ? AND matiere = ?').bind(classe, matiere).run();
  }
  return getHiddenMatieres(db);
}

/* ---------- Classes masquées pour les résumés (table "hidden_classes") ---------- */

export async function getHiddenClasses(db) {
  const { results } = await db.prepare('SELECT classe FROM hidden_classes').all();
  return (results || []).map(r => r.classe);
}

export async function setHiddenClasse(db, classe, hidden) {
  if (hidden) {
    await db.prepare('INSERT OR IGNORE INTO hidden_classes (classe) VALUES (?)').bind(classe).run();
  } else {
    await db.prepare('DELETE FROM hidden_classes WHERE classe = ?').bind(classe).run();
  }
  return getHiddenClasses(db);
}

/* ---------- Résumés : téléchargement gratuit limité + achat d'une matière complète ---------- */

export const RESUME_BUNDLE_PRICE = 500;        // FCFA, une matière complète
export const RESUME_CLASSE_BUNDLE_PRICE = 1500; // FCFA, toutes les matières d'une classe
export const RESUME_ALL_BUNDLE_PRICE = 4000;    // FCFA, toutes les classes (CI à CM2)
export const RESUME_FREE_DOWNLOAD_LIMIT = 5;
export const RESUME_FREE_DOWNLOAD_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

/* Le caractère '*' est utilisé comme joker :
   - { classe: 'CI', matiere: '*' }  -> toutes les matières de la classe CI achetées
   - { classe: '*',  matiere: '*' }  -> toutes les classes (CI à CM2) achetées */
export function hasResumePurchase(list, classe, matiere) {
  return (list || []).some(p =>
    (p.classe === '*' && p.matiere === '*') ||
    (p.classe === classe && p.matiere === '*') ||
    (p.classe === classe && p.matiere === matiere)
  );
}

export async function getResumePurchases(db, phone) {
  const { results } = await db.prepare('SELECT * FROM resume_purchases WHERE phone = ?').bind(phone).all();
  return (results || []).map(r => ({ classe: r.classe, matiere: r.matiere, purchasedAt: r.purchased_at, txId: r.tx_id }));
}

export async function addResumePurchase(db, phone, classe, matiere, txId) {
  const list = await getResumePurchases(db, phone);
  if (!hasResumePurchase(list, classe, matiere)) {
    await db.prepare(`
      INSERT OR IGNORE INTO resume_purchases (phone, classe, matiere, purchased_at, tx_id)
      VALUES (?,?,?,?,?)
    `).bind(phone, classe, matiere, Date.now(), txId).run();
  }
  return getResumePurchases(db, phone);
}

/* Historique des téléchargements gratuits (fenêtre glissante de 7 jours),
   table "resume_downloads" (une ligne par téléchargement). */
export async function countRecentDownloads(db, phone, windowStart) {
  const row = await db.prepare(
    'SELECT COUNT(*) AS c, MIN(ts) AS oldest FROM resume_downloads WHERE phone = ? AND ts >= ?'
  ).bind(phone, windowStart).first();
  return { count: (row && row.c) || 0, oldest: row ? row.oldest : null };
}

export async function addDownloadRecord(db, phone, ts) {
  await db.prepare('INSERT INTO resume_downloads (phone, ts) VALUES (?,?)').bind(phone, ts).run();
  // Nettoyage best-effort des entrées trop anciennes pour ce compte
  await db.prepare('DELETE FROM resume_downloads WHERE phone = ? AND ts < ?')
    .bind(phone, ts - RESUME_FREE_DOWNLOAD_WINDOW_MS).run();
}

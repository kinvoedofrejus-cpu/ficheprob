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

/* Formules d'abonnement. Index 0-3 = abonnement MANUEL (Mode Manuel seulement, historique), index 4-7 = abonnement
   ASSISTÉ (Mode Assisté ET Mode Manuel). Les index ne doivent JAMAIS être réordonnés : ils sont stockés sur les comptes. */
export const PLANS = [
  { days: 7,   label: '7 jours',   quota: 70,   amount: 500,  tier: 'manuel' },
  { days: 30,  label: '30 jours',  quota: 270,  amount: 1000, tier: 'manuel' },
  { days: 90,  label: '90 jours',  quota: 750,  amount: 1500, tier: 'manuel' },
  { days: 300, label: '300 jours', quota: 2500, amount: 5000, tier: 'manuel' },
  { days: 7,   label: '7 jours Assisté',   quota: 70,   amount: 750,  tier: 'assiste' },
  { days: 30,  label: '30 jours Assisté',  quota: 270,  amount: 1500, tier: 'assiste' },
  { days: 90,  label: '90 jours Assisté',  quota: 750,  amount: 2250, tier: 'assiste' },
  { days: 300, label: '300 jours Assisté', quota: 2500, amount: 7500, tier: 'assiste' },
  /* Niveaux de compte (novembre 2026) : index 8-10 = Base, 11-13 = Standard, 14-16 = Premium.
     Le niveau Gratuit n'a pas de formule (pas de durée ni de paiement) : voir GRATUIT_PLAN_INDEX. */
  { days: 30,  label: '30 jours Base',  quota: 270,  amount: 500,  tier: 'base' },
  { days: 90,  label: '90 jours Base',  quota: 750,  amount: 1000, tier: 'base' },
  { days: 300, label: '300 jours Base', quota: 2500, amount: 3000, tier: 'base' },
  { days: 30,  label: '30 jours Standard',  quota: 270,  amount: 750,  tier: 'standard' },
  { days: 90,  label: '90 jours Standard',  quota: 750,  amount: 1500, tier: 'standard' },
  { days: 300, label: '300 jours Standard', quota: 2500, amount: 4500, tier: 'standard' },
  { days: 30,  label: '30 jours Premium',  quota: 270,  amount: 1000, tier: 'premium' },
  { days: 90,  label: '90 jours Premium',  quota: 750,  amount: 2000, tier: 'premium' },
  { days: 300, label: '300 jours Premium', quota: 2500, amount: 6000, tier: 'premium' }
];
const KNOWN_PLAN_TIERS = ['manuel', 'assiste', 'base', 'standard', 'premium'];
export function planIndexFor(days, tier) {
  const t = KNOWN_PLAN_TIERS.includes(tier) ? tier : 'manuel';
  return PLANS.findIndex(p => p.days === Number(days) && p.tier === t);
}

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
  const result = await verifyFedaPaySignatureDebug(secret, rawBody, headerSig);
  return result.valid;
}

/* Version diagnostique : teste plusieurs formats de signature possibles
   (brute, ou horodatée façon Stripe "t=...,v1=...") et renvoie le détail
   de la comparaison. Utilisé temporairement pour identifier le format
   exact utilisé par FedaPay quand la vérification échoue en production. */
export async function verifyFedaPaySignatureDebug(secret, rawBody, headerSig) {
  if (!headerSig) return { valid: false, reason: 'missing_header' };
  const clean = headerSig.replace(/^sha256=/i, '').trim();

  const candidates = {};
  candidates.raw_hex = await hmacHex(secret, rawBody);
  candidates.raw_b64 = await hmacBase64(secret, rawBody);

  // FedaPay peut envoyer un header du style "t=169...,v1=abcdef..." (comme Stripe)
  const parts = {};
  headerSig.split(',').forEach(p => {
    const idx = p.indexOf('=');
    if (idx > -1) parts[p.slice(0, idx).trim()] = p.slice(idx + 1).trim();
  });
  const ts = parts.t;
  const sigFromHeader = parts.v1 || parts.s || parts.signature || clean;

  if (ts) {
    const signedPayload = `${ts}.${rawBody}`;
    candidates.ts_hex = await hmacHex(secret, signedPayload);
    candidates.ts_b64 = await hmacBase64(secret, signedPayload);
  }

  const valid = Object.values(candidates).some(c => c === sigFromHeader || c === clean);
  return { valid, candidates, sigFromHeader, ts, clean, headerSig };
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

/* Fin d'abonnement (novembre 2026) : un compte payant (ou ambassadeur) dont la date est dépassée repasse AUTOMATIQUEMENT
   au niveau Gratuit, avec le même numéro et le même code d'accès (il reste connecté). Fait à la lecture du compte, donc
   dès le premier appel qui suit l'expiration. Le quota de fiches repart de zéro ; les compteurs du niveau Gratuit
   (par jour) s'appliquent. Il suffit de repayer pour retrouver un niveau payant. */
async function downgradeIfExpired(db, u) {
  if (!u || u.planIndex === GRATUIT_PLAN_INDEX || !u.expiryTs || u.expiryTs > Date.now()) return u;
  const now = Date.now();
  const free = Object.assign({}, u, {
    planIndex: GRATUIT_PLAN_INDEX,
    planLabel: GRATUIT_PLAN_LABEL,
    expiryTs: now + 100 * 365 * 24 * 60 * 60 * 1000,
    quotaTotal: 999999999,
    quotaUsed: 0,
    promo: null,
    updatedAt: now,
    history: [...(u.history || []), { code: u.code, planLabel: GRATUIT_PLAN_LABEL, expiryTs: now, generatedAt: now, source: 'expiration', previousPlan: u.planLabel }]
  });
  try { await upsertUser(db, free); } catch (e) { return u; }
  return free;
}

export async function getUser(db, phone) {
  const row = await db.prepare('SELECT * FROM users WHERE phone = ?').bind(phone).first();
  return downgradeIfExpired(db, rowToUser(row));
}

export async function getUserByCode(db, code) {
  const row = await db.prepare('SELECT * FROM users WHERE code = ?').bind(code).first();
  return downgradeIfExpired(db, rowToUser(row));
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
  try { await db.prepare('DELETE FROM account_emails WHERE phone = ?').bind(phone).run(); } catch (e) { /* table absente : rien à nettoyer */ }
}

/* Change la clé primaire (téléphone) d'un compte existant : on ne peut pas faire
   d'UPDATE de la clé primaire proprement en gardant les FK, donc on supprime puis
   réinsère avec le nouveau numéro. */
export async function renameUserPhone(db, oldPhone, newPhone) {
  const u = await getUser(db, oldPhone);
  if (!u) return null;
  u.phone = newPhone;
  let savedEmail = '';
  try { const r = await db.prepare('SELECT email FROM account_emails WHERE phone = ?').bind(oldPhone).first(); savedEmail = r ? r.email : ''; } catch (e) {}
  await deleteUser(db, oldPhone);
  await upsertUser(db, u);
  if (savedEmail) { try { await db.prepare('INSERT OR REPLACE INTO account_emails (phone, email, verified_at) VALUES (?,?,?)').bind(newPhone, savedEmail, Date.now()).run(); } catch (e) {} }
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
export const RESUME_CLASSE_BUNDLE_PRICE = 1500; // FCFA, toutes les matières d'une classe (19/10/2026 : 3 000 → 1 500)
export const RESUME_ALL_BUNDLE_PRICE = 5200;    // FCFA, toutes les classes (CI à CM2) (19/10/2026 : 8 000 → 5 200)
export const RESUME_FREE_DOWNLOAD_LIMIT = 5;
export const RESUME_FREE_DOWNLOAD_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

/* Téléchargements groupés ("toute la classe" / "toutes les classes") gratuits
   pour les comptes ayant souscrit la formule "300 jours" (PLANS[3]) :
   RESUME_BULK_FREE_LIMIT téléchargements gratuits sur une fenêtre glissante
   de 300 jours ; au-delà, le paiement à l'unité (RESUME_CLASSE_BUNDLE_PRICE /
   RESUME_ALL_BUNDLE_PRICE) redevient nécessaire. Les autres formules
   d'abonnement ne bénéficient pas de ces téléchargements gratuits et passent
   directement par le paiement, comme avant. */
export const RESUME_BULK_FREE_LIMIT = 3;
export const RESUME_BULK_WINDOW_MS = 300 * 24 * 60 * 60 * 1000;
export const RESUME_BULK_PLAN_INDEX = 3; // index de PLANS correspondant à "300 jours"

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

/* Historique des téléchargements gratuits, table "resume_downloads" (une
   ligne par téléchargement). Deux "kind" distincts partagent la même table :
   - 'single' (par défaut) : téléchargement d'un résumé à l'unité, fenêtre
     glissante de 7 jours, limite RESUME_FREE_DOWNLOAD_LIMIT.
   - 'bulk' : téléchargement groupé "toute la classe" / "toutes les classes",
     fenêtre glissante de 300 jours, limite RESUME_BULK_FREE_LIMIT — réservé
     aux comptes avec un abonnement 300 jours (voir record-resume-bulk-download.js). */
export async function countRecentDownloads(db, phone, windowStart, kind) {
  kind = kind || 'single';
  const row = await db.prepare(
    'SELECT COUNT(*) AS c, MIN(ts) AS oldest FROM resume_downloads WHERE phone = ? AND kind = ? AND ts >= ?'
  ).bind(phone, kind, windowStart).first();
  return { count: (row && row.c) || 0, oldest: row ? row.oldest : null };
}

export async function addDownloadRecord(db, phone, ts, kind) {
  kind = kind || 'single';
  const windowMs = kind === 'bulk' ? RESUME_BULK_WINDOW_MS : RESUME_FREE_DOWNLOAD_WINDOW_MS;
  await db.prepare('INSERT INTO resume_downloads (phone, ts, kind) VALUES (?,?,?)').bind(phone, ts, kind).run();
  // Nettoyage best-effort des entrées trop anciennes pour ce compte
  await db.prepare('DELETE FROM resume_downloads WHERE phone = ? AND kind = ? AND ts < ?')
    .bind(phone, kind, ts - windowMs).run();
}

/* =========================================================================
   FICHE PRÊTE (fiches déjà rédigées, vendues par matière ou par classe) —
   mêmes mécanismes que les résumés (tables dédiées readyfiche_purchases /
   readyfiche_downloads), mais téléchargement UNIQUE par matière (pas de
   quota glissant) : une fois téléchargée, une matière achetée ne se
   retélécharge plus (voir record-readyfiche-download.js). */
export const READYFICHE_MATIERE_PRICE = 600;   // FCFA, une matière complète (12/10/2026 : 600 F ; plus de forfait « toute la classe »)
export const READYFICHE_CLASSE_PRICE = 2500;   // FCFA, toute la classe (toutes matières)

/* Prix des Fiches Prêtes modifiables depuis l'admin (13/10/2026).
   Réglage « readyfiche_prices » = { defaultPrice, overrides: { "CM1::francais": 0, ... } }.
   - defaultPrice : prix de toute matière sans prix particulier (défaut = READYFICHE_MATIERE_PRICE) ;
   - overrides   : prix particulier d'une matière précise (clé "classe::matiere").
   Un prix à 0 = fiche GRATUITE (accessible à tout compte valide, sans paiement). */
export async function getReadyFichePrices(db) {
  const v = await getSetting(db, 'readyfiche_prices', null);
  const def = (v && Number.isFinite(Number(v.defaultPrice))) ? Math.max(0, Math.round(Number(v.defaultPrice))) : READYFICHE_MATIERE_PRICE;
  const overrides = {};
  if (v && v.overrides && typeof v.overrides === 'object') {
    for (const k of Object.keys(v.overrides)) {
      const n = Number(v.overrides[k]);
      if (Number.isFinite(n) && n >= 0) overrides[k] = Math.round(n);
    }
  }
  return { defaultPrice: def, overrides };
}
export async function setReadyFichePrices(db, defaultPrice, overrides) {
  const clean = {};
  for (const k of Object.keys(overrides || {})) {
    const n = Number(overrides[k]);
    if (/^[^:]+::[^:]+$/.test(k) && Number.isFinite(n) && n >= 0) clean[k] = Math.round(n);
  }
  const def = Math.max(0, Math.round(Number(defaultPrice)));
  if (!Number.isFinite(def)) throw new Error('Prix par défaut invalide');
  await setSetting(db, 'readyfiche_prices', { defaultPrice: def, overrides: clean });
  return { defaultPrice: def, overrides: clean };
}
export function readyFichePriceFor(prices, classe, matiere) {
  const k = `${classe}::${matiere}`;
  if (prices && prices.overrides && Object.prototype.hasOwnProperty.call(prices.overrides, k)) return prices.overrides[k];
  return prices ? prices.defaultPrice : READYFICHE_MATIERE_PRICE;
}

export function hasReadyFichePurchase(list, classe, matiere) {
  return (list || []).some(p =>
    (p.classe === classe && p.matiere === '*') ||
    (p.classe === classe && p.matiere === matiere)
  );
}

/* Format Word (28/10/2026). Le forfait « toute la classe » existe en 2 versions : PDF 5 200 F et Word 8 300 F, et ne donne droit
   qu'au format payé. Le format est mémorisé dans la colonne « source » de la transaction (null/'pdf' = PDF, 'word' = Word) : aucune
   migration de base de données. Les achats à la matière (et matières gratuites) restent valables pour les deux formats. */
export const READYFICHE_CLASSE_PRICE_WORD = 8300;
export function readyFormatOfTx(tx) { return tx && tx.source === 'word' ? 'word' : 'pdf'; }
export async function readyFormatAllowed(db, purchases, classe, matiere, format) {
  const fmt = format === 'word' ? 'word' : 'pdf';
  const rows = (purchases || []).filter(p => p.classe === classe && (p.matiere === matiere || p.matiere === '*'));
  if (!rows.length) return true;                       // gratuit / ambassadeur : pas de contrainte
  for (const p of rows) {
    if (p.matiere !== '*') return true;                // achat à la matière : les deux formats
    if (readyFormatOfTx(p.txId ? await getTx(db, p.txId) : null) === fmt) return true;
  }
  return false;
}

export async function getReadyFichePurchases(db, phone) {
  const { results } = await db.prepare('SELECT * FROM readyfiche_purchases WHERE phone = ?').bind(phone).all();
  return (results || []).map(r => ({ classe: r.classe, matiere: r.matiere, tier: r.tier, purchasedAt: r.purchased_at, txId: r.tx_id }));
}

export async function addReadyFichePurchase(db, phone, classe, matiere, tier, txId) {
  await db.prepare(`
    INSERT OR IGNORE INTO readyfiche_purchases (phone, classe, matiere, tier, purchased_at, tx_id)
    VALUES (?,?,?,?,?,?)
  `).bind(phone, classe, matiere, tier || 'matiere', Date.now(), txId).run();
  return getReadyFichePurchases(db, phone);
}

export function hasReadyFicheDownload(list, classe, matiere) {
  return (list || []).some(d => d.classe === classe && d.matiere === matiere);
}

export async function getReadyFicheDownloads(db, phone) {
  const { results } = await db.prepare('SELECT * FROM readyfiche_downloads WHERE phone = ?').bind(phone).all();
  return (results || []).map(r => ({ classe: r.classe, matiere: r.matiere, downloadedAt: r.downloaded_at }));
}

export async function addReadyFicheDownload(db, phone, classe, matiere) {
  await db.prepare(`
    INSERT OR IGNORE INTO readyfiche_downloads (phone, classe, matiere, downloaded_at)
    VALUES (?,?,?,?)
  `).bind(phone, classe, matiere, Date.now()).run();
}

/* ===== Versions corrigées (29/10/2026) =====
   L'admin « publie une version corrigée » d'une matière (admin-readyfiche-suivi.js) : on mémorise la date (réglage
   « readyfiche_versions » = { "CLASSE::matiere": { v, updatedAt, note } }). Un acheteur qui a téléchargé AVANT cette date retrouve
   UN téléchargement gratuit de la version corrigée. Aucune migration : on compare readyfiche_downloads.downloaded_at à updatedAt. */
export async function getReadyVersions(db) {
  const v = await getSetting(db, 'readyfiche_versions', null);
  return (v && typeof v === 'object') ? v : {};
}
export async function bumpReadyVersion(db, classe, matiere, note) {
  const all = await getReadyVersions(db);
  const k = `${classe}::${matiere}`;
  const cur = all[k] || { v: 1 };
  all[k] = { v: (Number(cur.v) || 1) + 1, updatedAt: Date.now(), note: String(note || '').slice(0, 240) };
  await setSetting(db, 'readyfiche_versions', all);
  return all[k];
}
export function readyUpdateAvailable(versions, classe, matiere, downloadedAt) {
  const e = versions && versions[`${classe}::${matiere}`];
  return !!(e && e.updatedAt && Number(downloadedAt || 0) < Number(e.updatedAt));
}
export async function refreshReadyFicheDownload(db, phone, classe, matiere) {
  await db.prepare('UPDATE readyfiche_downloads SET downloaded_at = ? WHERE phone = ? AND classe = ? AND matiere = ?')
    .bind(Date.now(), phone, classe, matiere).run();
}

/* ===== Événements Fiche Prête (statistiques, 29/10/2026) =====
   Compteurs par jour : 'preview' (aperçu PDF ouvert), 'preview_word' (aperçu Word), 'dl_pdf' / 'dl_word' (téléchargement validé).
   Table créée au besoin (CREATE TABLE IF NOT EXISTS) : aucune migration à lancer. */
let eventsTableReady = false;
export async function ensureEventsTable(db) {
  if (eventsTableReady) return;
  await db.prepare(`CREATE TABLE IF NOT EXISTS readyfiche_events (
    day TEXT NOT NULL, event TEXT NOT NULL, classe TEXT NOT NULL, matiere TEXT NOT NULL, n INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (day, event, classe, matiere)
  )`).run();
  eventsTableReady = true;
}
export const READYFICHE_EVENTS = ['preview', 'preview_word', 'dl_pdf', 'dl_word'];
export async function trackReadyEvent(db, event, classe, matiere) {
  try {
    if (!READYFICHE_EVENTS.includes(event) || !/^[A-Za-z0-9_-]{1,40}$/.test(String(classe || '')) || !/^[A-Za-z0-9_-]{1,60}$/.test(String(matiere || ''))) return;
    await ensureEventsTable(db);
    const day = new Date().toISOString().slice(0, 10);
    await db.prepare(`INSERT INTO readyfiche_events (day, event, classe, matiere, n) VALUES (?,?,?,?,1)
      ON CONFLICT(day, event, classe, matiere) DO UPDATE SET n = n + 1`).bind(day, event, String(classe), String(matiere)).run();
  } catch (e) { /* les statistiques ne doivent jamais bloquer un téléchargement */ }
}

/* =========================================================================
   FICHE PRÊTE SANS COMPTE (demande du 14/10/2026)
   Un visiteur sans compte peut acheter autant de Fiches Prêtes qu'il veut.
   Chaque achat = une transaction FedaPay (type 'readyfiche', tier 'guest')
   liée à un jeton secret généré par l'appareil de l'acheteur : seul le
   HACHAGE du jeton est stocké (colonne transactions.code), jamais le jeton.
   Un achat donne droit à UN téléchargement (consommé dans readyfiche_downloads
   sous la clé « guest:<id de transaction> »), comme pour les comptes. */
async function sha256Hex(str) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(String(str)));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}
export async function hashGuestToken(token) { return sha256Hex('fpb-guest:' + String(token || '')); }
export function guestDownloadKey(txId) { return 'guest:' + String(txId); }
export async function checkGuestReadyFiche(db, txId, token, classe, matiere) {
  if (!txId || !token || String(token).length < 16 || !classe || !matiere) return { ok: false, reason: 'invalid', status: 400 };
  const tx = await getTx(db, txId);
  if (!tx || tx.type !== 'readyfiche' || tx.tier !== 'guest') return { ok: false, reason: 'invalid', status: 401 };
  if ((await hashGuestToken(token)) !== tx.code) return { ok: false, reason: 'invalid', status: 401 };
  if (tx.status !== 'paid' || tx.classe !== classe || tx.matiere !== matiere) return { ok: false, reason: 'notpurchased', status: 403 };
  const done = await getReadyFicheDownloads(db, guestDownloadKey(tx.id));
  if (hasReadyFicheDownload(done, classe, matiere)) return { ok: false, reason: 'alreadydownloaded', status: 409 };
  return { ok: true, tx };
}

/* Classes dont les fiches sont PRÉ-GÉNÉRÉES côté serveur (PDF de base, sans
   nom d'enseignant, stocké une fois pour toutes dans R2 sous la clé
   readyfiche-pdfs/{classe}/{matiere}.pdf — voir admin-pregenerate-readyfiches.js
   et get-readyfiche-pdf.js). Les autres classes (contenu encore incomplet)
   continuent de générer le PDF à la volée côté client. */
export const READYFICHE_PREGENERATED_CLASSES = ['CM1', 'CM2'];

/* =========================================================================
   1er TÉLÉCHARGEMENT OFFERT + RESSOURCES DIDACTIQUES PAYANTES DÈS LE 2e
   - kind 'matiere' : téléchargement groupé d'une matière de résumés
     (ref = "classe::matiere") ; le paiement passe par create-resume-payment.js.
   - kind 'resource' : ressource didactique (ref = id) ; le paiement passe par
     create-resource-payment.js et débloque cette ressource pour de bon.
   ========================================================================= */
export const RESOURCE_PRICE = 500; // FCFA, une ressource didactique (à partir du 2e téléchargement)

export async function hasFirstDownload(db, phone, kind, ref) {
  const row = await db.prepare('SELECT 1 AS x FROM first_downloads WHERE phone = ? AND kind = ? AND ref = ?')
    .bind(phone, kind, ref).first();
  return !!row;
}

export async function addFirstDownload(db, phone, kind, ref) {
  await db.prepare('INSERT OR IGNORE INTO first_downloads (phone, kind, ref, ts) VALUES (?,?,?,?)')
    .bind(phone, kind, ref, Date.now()).run();
}

/* Politique de téléchargement choisie par l'admin (onglet Abonnements du dashboard), SÉPARÉMENT pour les RESSOURCES
   et pour les RÉSUMÉS. Trois valeurs possibles :
   - 'normal'  : règles du 12/10/2026 (1er téléchargement offert, 1 classe gratuite d'ambassadeur, achats au-delà) ;
   - 'payant'  : plus aucun téléchargement gratuit — seul un achat réel donne accès (ressources « débloquées gratuitement »
                 avant l'activation comprises). Les comptes ambassadeurs sont EXEMPTÉS (ils gardent les règles normales) ;
   - 'gratuit' : téléchargement totalement gratuit et illimité pour tout le monde, sans compte, sans achat.
   La lecture à l'écran des résumés reste toujours possible. Défaut : 'normal'. */
export const DOWNLOAD_POLICIES = ['normal', 'payant', 'gratuit'];
export const DOWNLOAD_POLICY_KINDS = ['resources', 'resumes'];
export async function getDownloadPolicies(db) {
  const r = await getSetting(db, 'download_policy_resources', 'normal');
  const u = await getSetting(db, 'download_policy_resumes', 'normal');
  return {
    resources: DOWNLOAD_POLICIES.includes(r) ? r : 'normal',
    resumes: DOWNLOAD_POLICIES.includes(u) ? u : 'normal'
  };
}
export async function setDownloadPolicy(db, kind, policy) {
  await setSetting(db, kind === 'resources' ? 'download_policy_resources' : 'download_policy_resumes', policy);
}

/* Achat RÉEL d'une ressource (exclut les déblocages gratuits, enregistrés avec tx_id = 'free'). */
export async function hasPaidResourcePurchase(db, phone, resourceId) {
  const row = await db.prepare("SELECT 1 AS x FROM resource_purchases WHERE phone = ? AND resource_id = ? AND (tx_id IS NULL OR tx_id <> 'free')")
    .bind(phone, resourceId).first();
  return !!row;
}

export async function hasResourcePurchase(db, phone, resourceId) {
  const row = await db.prepare('SELECT 1 AS x FROM resource_purchases WHERE phone = ? AND resource_id = ?')
    .bind(phone, resourceId).first();
  return !!row;
}

export async function addResourcePurchase(db, phone, resourceId, txId) {
  await db.prepare('INSERT OR IGNORE INTO resource_purchases (phone, resource_id, purchased_at, tx_id) VALUES (?,?,?,?)')
    .bind(phone, resourceId, Date.now(), txId).run();
}


/* ---------- Ambassadeurs FicheProBot ---------- */
export const AMBASSADOR_STATUTS = ['FE', 'ACDPE', 'ACDPCT', 'AME'];
export const AMBASSADOR_FONCTIONS = ['Enseignant en situation de classe', 'Directeur', 'CP', 'Inspecteur'];
export const AMBASSADOR_STATES = ['nouveau', 'contacte', 'accepte', 'refuse'];

/* Compte ambassadeur = ligne de la table "users" avec plan_index 99 (aucun plan de PLANS n'a cet
   index). Il a les avantages du compte propriétaire (fiches illimitées, téléchargements gratuits
   et illimités) mais : validité 1 an renouvelable, nom figé sur les fiches, fiche verrouillée une
   fois téléchargée en PDF. */
export const AMBASSADOR_PLAN_INDEX = 99;
export const AMBASSADOR_PLAN_LABEL = 'Ambassadeur';
export const AMBASSADOR_VALIDITY_MS = 365 * 24 * 60 * 60 * 1000;
export const AMBASSADOR_UNLIMITED_QUOTA = 999999999;
export function isAmbassadorUser(u) {
  return !!u && u.planIndex === AMBASSADOR_PLAN_INDEX;
}

let ambassadorsTableReady = false;

/* Crée la table au premier appel (une fois par instance) : aucun SQL à lancer à la main.
   Ajoute aussi, sur une base existante, les colonnes code / expiry_ts / accepted_at. */
export async function ensureAmbassadorsTable(db) {
  if (ambassadorsTableReady) return;
  await db.prepare(`CREATE TABLE IF NOT EXISTS ambassadors (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    numero      TEXT,
    nom         TEXT NOT NULL,
    prenoms     TEXT NOT NULL,
    statut      TEXT NOT NULL,
    fonction    TEXT NOT NULL,
    residence   TEXT NOT NULL,
    lieu        TEXT NOT NULL,
    phone       TEXT NOT NULL,
    email       TEXT,
    status      TEXT NOT NULL DEFAULT 'nouveau',
    created_at  INTEGER NOT NULL,
    code        TEXT,
    expiry_ts   INTEGER,
    accepted_at INTEGER
  )`).run();
  for (const col of ['code TEXT', 'expiry_ts INTEGER', 'accepted_at INTEGER']) {
    try { await db.prepare('ALTER TABLE ambassadors ADD COLUMN ' + col).run(); } catch (e) { /* colonne déjà présente */ }
  }
  ambassadorsTableReady = true;
}

export function ambassadorFromRow(r) {
  return {
    id: r.id, numero: r.numero, nom: r.nom, prenoms: r.prenoms, statut: r.statut,
    fonction: r.fonction, residence: r.residence, lieu: r.lieu, phone: r.phone,
    email: r.email || '', status: r.status, createdAt: r.created_at,
    code: r.code || '', expiryTs: r.expiry_ts || null, acceptedAt: r.accepted_at || null
  };
}

/* =========================================================================
   RÉGLAGES GLOBAUX (table "settings", clé/valeur générique) — pilotés depuis
   l'onglet "Abonnements" du dashboard admin :
   - mode gratuit/payant (stoppe/relance l'obligation d'abonnement pour tout
     le monde, avec une date de fin optionnelle) ;
   - bonus de fiches automatique à chaque souscription de la formule la moins
     chère (PLANS[MIN_PLAN_INDEX]), + un bonus ponctuel offert d'un coup à
     tous les abonnés déjà actifs ;
   - prix des abonnements (remplace PLANS[i].amount par défaut), lus par
     create-payment.js (facturation) et exposés publiquement par get-plans.js
     (affichage côté front).
   Table créée automatiquement au premier appel, comme pour "ambassadors" —
   rien à lancer à la main.
   ========================================================================= */
let settingsTableReady = false;
export async function ensureSettingsTable(db) {
  if (settingsTableReady) return;
  await db.prepare(`CREATE TABLE IF NOT EXISTS settings (
    key   TEXT PRIMARY KEY,
    value TEXT
  )`).run();
  settingsTableReady = true;
}

export async function getSetting(db, key, defaultValue = null) {
  await ensureSettingsTable(db);
  const row = await db.prepare('SELECT value FROM settings WHERE key = ?').bind(key).first();
  if (!row) return defaultValue;
  try { return JSON.parse(row.value); } catch { return row.value; }
}

export async function setSetting(db, key, value) {
  await ensureSettingsTable(db);
  await db.prepare(`
    INSERT INTO settings (key, value) VALUES (?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `).bind(key, JSON.stringify(value)).run();
}

/* ---- Mode gratuit / payant ---- */
export async function getAppMode(db) {
  const mode = await getSetting(db, 'app_mode', 'payant');
  const until = await getSetting(db, 'app_mode_until', null);
  // Date de fin programmée dépassée : on repasse automatiquement en mode payant.
  if (mode === 'gratuit' && until && until <= Date.now()) {
    await setSetting(db, 'app_mode', 'payant');
    await setSetting(db, 'app_mode_until', null);
    return { mode: 'payant', until: null };
  }
  return { mode: mode === 'gratuit' ? 'gratuit' : 'payant', until: mode === 'gratuit' ? (until || null) : null };
}

export async function setAppMode(db, mode, until) {
  if (mode !== 'gratuit' && mode !== 'payant') throw new Error('Mode invalide');
  await setSetting(db, 'app_mode', mode);
  await setSetting(db, 'app_mode_until', mode === 'gratuit' ? (until || null) : null);
}

/* ---- Nombre de fiches gratuites en mode gratuit (réglable depuis l'admin) ----
   daily  : fiches gratuites par jour et par appareil
   weekly : plafond hebdomadaire (semaine du lundi au dimanche)
   Valeurs par défaut = anciennes valeurs codées en dur (4 par jour, 20 par semaine). */
export const FREE_LIMITS_DEFAULT = { daily: 4, weekly: 20 };

export async function getFreeLimits(db) {
  const raw = await getSetting(db, 'free_limits', null);
  const clean = (v, d) => {
    const n = parseInt(v, 10);
    return Number.isFinite(n) && n >= 0 ? Math.min(n, 9999) : d;
  };
  return {
    daily: clean(raw && raw.daily, FREE_LIMITS_DEFAULT.daily),
    weekly: clean(raw && raw.weekly, FREE_LIMITS_DEFAULT.weekly)
  };
}
export async function setFreeLimits(db, daily, weekly) {
  const d = parseInt(daily, 10), w = parseInt(weekly, 10);
  if (!Number.isFinite(d) || d < 0 || !Number.isFinite(w) || w < 0) throw new Error('Nombres invalides (entiers ≥ 0 attendus).');
  await setSetting(db, 'free_limits', { daily: Math.min(d, 9999), weekly: Math.min(w, 9999) });
}

/* ---- Bonus automatique de fiches à la formule la moins chère ---- */
export const MIN_PLAN_INDEX = 0; // PLANS[0] = "7 jours", la formule d'entrée

export async function getMinPlanBonus(db) {
  return (await getSetting(db, 'min_plan_bonus', 0)) || 0;
}
export async function setMinPlanBonus(db, bonus) {
  await setSetting(db, 'min_plan_bonus', Math.max(0, parseInt(bonus, 10) || 0));
}

/* ---- Prix des abonnements modifiables depuis l'admin ---- */
export async function getPlanAmounts(db) {
  const override = await getSetting(db, 'plan_amounts', null);
  if (Array.isArray(override) && override.length === PLANS.length) return override;
  // Prix enregistrés avant l'arrivée des niveaux Base/Standard/Premium (8 formules) : on les garde, et on complète
  // avec les prix par défaut des nouvelles formules.
  if (Array.isArray(override) && override.length === 8) return [...override, ...PLANS.slice(8).map(p => p.amount)];
  // Anciens prix enregistrés (4 formules Manuel seulement) : on les garde, et l'Assisté = Manuel + 50 % par défaut.
  if (Array.isArray(override) && override.length === 4) {
    return [...override, ...override.map(a => Math.round(a * 1.5 / 50) * 50), ...PLANS.slice(8).map(p => p.amount)];
  }
  return PLANS.map(p => p.amount);
}
export async function setPlanAmounts(db, amounts) {
  if (!Array.isArray(amounts) || amounts.length !== PLANS.length) throw new Error('Liste de prix invalide');
  await setSetting(db, 'plan_amounts', amounts.map(a => Math.max(0, parseInt(a, 10) || 0)));
}
/* Nombre de fiches de chaque formule (modifiable depuis l'admin ; les durées restent celles de PLANS). */
export async function getPlanQuotas(db) {
  const o = await getSetting(db, 'plan_quotas', null);
  if (Array.isArray(o) && o.length === PLANS.length) return o.map((q, i) => (Number.isFinite(Number(q)) && Number(q) >= 0 ? Math.floor(Number(q)) : PLANS[i].quota));
  return PLANS.map(p => p.quota);
}
export async function setPlanQuotas(db, quotas) {
  if (!Array.isArray(quotas) || quotas.length !== PLANS.length) throw new Error('Liste de quotas invalide');
  await setSetting(db, 'plan_quotas', quotas.map(q => Math.min(1000000, Math.max(0, parseInt(q, 10) || 0))));
}
export async function getEffectivePlans(db) {
  const [amounts, quotas] = await Promise.all([getPlanAmounts(db), getPlanQuotas(db)]);
  return PLANS.map((p, i) => ({ ...p, amount: amounts[i], quota: quotas[i] }));
}

/* Rubriques qui exigent un compte (réglable depuis l'admin). true = connexion obligatoire. */
export const LOGIN_GATE_KEYS = [
  { key: 'elaboration',    label: "Élaboration de fiches (Mode Manuel et Assisté)" },
  { key: 'integration',    label: "Fiche d'intégration" },
  { key: 'planification',  label: 'Planification mensuelle' },
  { key: 'statistiques',   label: 'Statistiques' },
  { key: 'pointExecution', label: "Point d'exécution du programme" },
  { key: 'listeAlpha',     label: 'Liste alphabétique' },
  { key: 'expression',     label: 'Expression écrite' },
  { key: 'demarches',      label: 'Lecture des démarches' }
];
export async function getLoginGates(db) {
  const o = await getSetting(db, 'login_gates', null);
  const out = {};
  for (const g of LOGIN_GATE_KEYS) out[g.key] = !(o && typeof o === 'object' && o[g.key] === false);
  return out;
}
export async function setLoginGates(db, gates) {
  const out = {};
  for (const g of LOGIN_GATE_KEYS) out[g.key] = !(gates && gates[g.key] === false);
  await setSetting(db, 'login_gates', out);
  return out;
}
/* Vérification à la création de compte : interrupteurs de l'admin (les clés Resend / WhatsApp restent dans Cloudflare). */
export async function getVerifSettings(db) {
  const o = await getSetting(db, 'verif_settings', null);
  const b = (v) => !(o && typeof o === 'object' && v === false);
  return { required: b(o && o.required), email: b(o && o.email), whatsapp: b(o && o.whatsapp) };
}
export async function setVerifSettings(db, v) {
  const out = { required: v && v.required !== false, email: v && v.email !== false, whatsapp: v && v.whatsapp !== false };
  await setSetting(db, 'verif_settings', out);
  return out;
}


/* =========================================================================
   Téléchargements — règles du 12/10/2026
   Propriétaire d'un quota ("owner") : le téléphone du compte (si phone+code valides),
   sinon "d<identifiant d'appareil>" pour un visiteur sans compte. Les tables existantes
   (resume_purchases, resource_purchases…) stockent cet owner dans leur colonne "phone".
   - RESSOURCES : 1 téléchargement gratuit PAR RESSOURCE (5 pour un compte ambassadeur) ;
     ensuite il faut des crédits : 500 F = 1, 1 000 F = 2, 1 500 F et plus = 3.
     Un crédit = un téléchargement d'une ressource.
   - RÉSUMÉS : matière = 1er téléchargement gratuit (par matière) puis 500 F ;
     toute la classe 3 000 F ; toutes les classes 8 000 F ; ambassadeur = UNE SEULE classe gratuite
     (« toute la classe » d'une classe au choix, ensuite acquise ; jamais « toutes les classes ») ;
     administrateur = tout gratuit et illimité (géré côté appli, sans passer par le serveur).
   ========================================================================= */
export const RESOURCE_FREE_PER_RESOURCE = 1;
export const RESOURCE_FREE_PER_RESOURCE_AMBASSADOR = 5;
export const RESUME_AMBASSADOR_FREE_CLASSES = 1;   // nombre de classes entières offertes à un ambassadeur
/* Ressources (règles révisées le 12/10/2026) : une ressource = un type (groupe) × un niveau (ex. « Exercices structuraux CE2 »).
   Dans chaque TYPE, le 1er niveau téléchargé est gratuit (5 pour un ambassadeur) ; un autre niveau du même type coûte
   RESOURCE_PRICE (500 F) ; tous les niveaux d'un type coûtent RESOURCE_GROUP_PRICE (1 500 F). Un niveau débloqué (gratuit ou payé)
   reste téléchargeable. Les achats sont stockés dans resource_purchases : resource_id = id de la ressource, ou 'all:<type>'. */
export const RESOURCE_GROUP_PRICE = 1500;
/* Cahier d'expression écrite (05/11/2026) : une page (un seul élève ou page vierge) = gratuit ; la liste complète
   (une page par élève) d'une classe coûte EE_LIST_PRICE, sauf pour le compte propriétaire. Achat stocké dans
   resource_purchases avec resource_id = 'cahier-ee:<classe>'. */
export const EE_LIST_PRICE = 500;
export function eeResourceId(classe) { return 'cahier-ee:' + String(classe || '').toUpperCase(); }
/* Démarches pédagogiques (05/11/2026) : 4 démarches (matières) téléchargeables gratuitement ; pour tout télécharger
   (toutes les démarches, avec page de garde et nom de l'enseignant) : DEM_ALL_PRICE, une seule fois. Achat stocké dans
   resource_purchases avec resource_id = DEM_ALL_RESOURCE_ID ; les démarches gratuites sont comptées dans download_usage
   (kind 'demarche', ref = clé de la démarche : re-télécharger la même reste gratuit). */
export const DEM_FREE_COUNT = 4;
export const DEM_ALL_PRICE = 1500;
export const DEM_ALL_RESOURCE_ID = 'demarches-all';
export const RESOURCE_GROUP_PREFIXES = ['exercices-structuraux', 'calcul-mental', 'concretisation', 'projet-planification',
  'schema-support', 'emploi-du-temps', 'fournitures-scolaires'];
export function resourceGroupOf(id) {
  const s = String(id || '');
  return RESOURCE_GROUP_PREFIXES.find(g => s.startsWith(g + '-')) || '';
}

let downloadTablesReady = false;
export async function ensureDownloadTables(db) {
  if (downloadTablesReady) return;
  await db.prepare(`CREATE TABLE IF NOT EXISTS download_usage (
    owner TEXT NOT NULL, kind TEXT NOT NULL, ref TEXT NOT NULL, n INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (owner, kind, ref))`).run();
  await db.prepare(`CREATE TABLE IF NOT EXISTS download_credits (
    owner TEXT PRIMARY KEY, credits INTEGER NOT NULL DEFAULT 0)`).run();
  downloadTablesReady = true;
}

export function cleanDeviceId(v) {
  const s = String(v || '').trim();
  return /^[A-Za-z0-9_-]{16,80}$/.test(s) ? s : '';
}

/* Identifie le propriétaire du quota. Compte valide (phone+code, actif, non expiré) -> son téléphone ;
   sinon appareil. Renvoie { owner, ambassador, account } ou { owner:'' } si rien d'exploitable. */
export async function resolveOwner(db, { phone, code, deviceId }) {
  const phoneDigits = normalizePhone(phone || '');
  const cleanCode = (code || '').trim().toUpperCase();
  if (phoneDigits.length >= 8 && cleanCode) {
    const rec = await getUser(db, phoneDigits);
    if (rec && (rec.code || '').toUpperCase() === cleanCode && rec.active && rec.expiryTs > Date.now()) {
      return { owner: phoneDigits, ambassador: isAmbassadorUser(rec), account: true, record: rec };
    }
  }
  const dev = cleanDeviceId(deviceId);
  if (dev) return { owner: 'd' + dev, ambassador: false, account: false };
  return { owner: '' };
}

export async function getUsage(db, owner, kind, ref) {
  const row = await db.prepare('SELECT n FROM download_usage WHERE owner = ? AND kind = ? AND ref = ?').bind(owner, kind, ref).first();
  return (row && row.n) || 0;
}
export async function incUsage(db, owner, kind, ref) {
  await db.prepare(`INSERT INTO download_usage (owner, kind, ref, n) VALUES (?,?,?,1)
    ON CONFLICT(owner, kind, ref) DO UPDATE SET n = n + 1`).bind(owner, kind, ref).run();
}
export async function getCredits(db, owner) {
  const row = await db.prepare('SELECT credits FROM download_credits WHERE owner = ?').bind(owner).first();
  return (row && row.credits) || 0;
}
export async function addCredits(db, owner, n) {
  await db.prepare(`INSERT INTO download_credits (owner, credits) VALUES (?,?)
    ON CONFLICT(owner) DO UPDATE SET credits = credits + excluded.credits`).bind(owner, n).run();
}
/* Consomme 1 crédit de façon atomique ; renvoie true si un crédit a été débité. */
export async function useCredit(db, owner) {
  const r = await db.prepare('UPDATE download_credits SET credits = credits - 1 WHERE owner = ? AND credits > 0').bind(owner).run();
  return !!(r && r.meta && r.meta.changes > 0);
}


/* URL de retour FedaPay : toujours sur le MÊME site que l'application (jamais un domaine fourni par le navigateur).
   FedaPay y ajoute ?id=<transaction>&status=<approved|declined|…> ; l'application reprend alors le processus en cours. */
export function pickCallbackUrl(cb, request) {
  const origin = new URL(request.url).origin;
  try {
    const u = new URL(String(cb || ''), origin);
    if (u.origin === origin) return u.href;
  } catch (e) { /* on retombe sur la page d'accueil */ }
  return origin + '/';
}

/* Lit une transaction directement chez FedaPay (vérification active, sans attendre le webhook). */
export async function fetchFedaTransaction(secretKey, id) {
  const r = await fetch('https://api.fedapay.com/v1/transactions/' + encodeURIComponent(id), {
    headers: { 'Authorization': 'Bearer ' + secretKey, 'Content-Type': 'application/json' }
  });
  if (!r.ok) return null;
  const d = await r.json().catch(() => null);
  if (!d) return null;
  return d['v1/transaction'] || d.transaction || d;
}

/* ---------- Suggestions, corrections et signalements d'erreurs des utilisateurs ----------
   Table créée automatiquement au premier appel (aucun SQL à lancer à la main). */
export const SUGGESTION_TYPES = ['suggestion', 'correction', 'erreur', 'autre'];
export const SUGGESTION_STATUTS = ['nouveau', 'lu', 'traite'];
let suggestionsTableReady = false;
export async function ensureSuggestionsTable(db) {
  if (suggestionsTableReady) return;
  await db.prepare(`CREATE TABLE IF NOT EXISTS suggestions (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    numero      TEXT,
    type        TEXT NOT NULL,
    concerne    TEXT,
    classe      TEXT,
    matiere     TEXT,
    message     TEXT NOT NULL,
    nom         TEXT,
    phone       TEXT,
    status      TEXT NOT NULL DEFAULT 'nouveau',
    created_at  INTEGER NOT NULL
  )`).run();
  suggestionsTableReady = true;
}
export function suggestionFromRow(r) {
  return {
    id: r.id, numero: r.numero || '', type: r.type, concerne: r.concerne || '', classe: r.classe || '',
    matiere: r.matiere || '', message: r.message, nom: r.nom || '', phone: r.phone || '',
    status: r.status, createdAt: r.created_at
  };
}


/* =========================================================================
   Niveaux de compte (novembre 2026) : Gratuit, Base, Standard, Premium
   - Gratuit : pas de durée ni de paiement (GRATUIT_PLAN_INDEX), seulement un nombre de fiches gratuites par jour.
   - Base / Standard / Premium : formules de 30, 90 et 300 jours (PLANS[8..16]).
   - Anciennes formules : Manuel (index 0-3) -> niveau Base ; Assisté (index 4-7) -> niveau Standard.
   - Compte ambassadeur et compte propriétaire : tout illimité (comme Premium sans plafond).
   Pour chaque niveau, l'admin règle le NOMBRE D'ACCÈS à chaque fonctionnalité (TIER_FEATURES) :
     -1 = illimité, 0 = pas d'accès, n = n accès. Période de comptage : par jour (unit 'jour') ou sur toute la
     validité de l'abonnement (unit 'validite' ; pour le niveau Gratuit : par mois civil).
   Les compteurs sont stockés dans download_usage (kind 'tier:<fonctionnalité>', ref = clé de période).
   ========================================================================= */
export const GRATUIT_PLAN_INDEX = 98;
export const GRATUIT_PLAN_LABEL = 'Gratuit';
export const TIER_IDS = ['gratuit', 'base', 'standard', 'premium'];
export const TIER_LABELS = { gratuit: 'Gratuit', base: 'Base', standard: 'Standard', premium: 'Premium' };

/* key : identifiant stable (stocké en base) ; unit : période de comptage ; label : libellé affiché dans l'admin. */
export const TIER_FEATURES = [
  { key: 'fiches',         unit: 'jour',     label: 'Fiches par jour (tous modes)' },
  { key: 'assiste',        unit: 'jour',     label: 'Fiches en Mode Assisté par jour' },
  { key: 'integration',    unit: 'validite', label: "Plafond de fiches d'intégration (0 = sans plafond, comptées dans les fiches par jour)" },
  { key: 'epreuve',        unit: 'jour',     label: "Génération d'épreuves par jour" },
  { key: 'resumesDl',      unit: 'validite', label: 'Téléchargements de résumés (matières)' },
  { key: 'ressourcesDl',   unit: 'validite', label: 'Téléchargements de ressources' },
  { key: 'planification',  unit: 'validite', label: 'Planification mensuelle (accès)' },
  { key: 'statistiques',   unit: 'validite', label: 'Statistiques du mois (accès)' },
  { key: 'pointExecution', unit: 'validite', label: "Point d'exécution du programme (accès)" },
  { key: 'listeAlpha',     unit: 'validite', label: 'Liste alphabétique (accès)' },
  { key: 'expression',     unit: 'validite', label: 'Expression écrite (accès)' },
  { key: 'demarches',      unit: 'validite', label: 'Lecture des démarches (accès)' }
];

export const TIER_LIMITS_DEFAULT = {
  gratuit:  { fiches: 2,  assiste: 0,  integration: 0, epreuve: 1,  resumesDl: 0, ressourcesDl: 0, planification: 0,  statistiques: 0,  pointExecution: 0,  listeAlpha: 0,  expression: 0,  demarches: 0 },
  base:     { fiches: -1, assiste: 2,  integration: 4, epreuve: 3,  resumesDl: 0, ressourcesDl: 0, planification: 0,  statistiques: 0,  pointExecution: 0,  listeAlpha: -1, expression: 0,  demarches: 0 },
  standard: { fiches: -1, assiste: 4,  integration: 8, epreuve: 5,  resumesDl: 3, ressourcesDl: 3, planification: -1, statistiques: -1, pointExecution: -1, listeAlpha: -1, expression: 0,  demarches: -1 },
  premium:  { fiches: -1, assiste: -1, integration: -1, epreuve: -1, resumesDl: 6, ressourcesDl: 6, planification: -1, statistiques: -1, pointExecution: -1, listeAlpha: -1, expression: -1, demarches: -1 }
};

/* Niveau d'un compte (enregistrement de la table users) : 'gratuit' | 'base' | 'standard' | 'premium'. */
export function tierOfPlanIndex(planIndex) {
  const i = Number(planIndex);
  if (i === GRATUIT_PLAN_INDEX) return 'gratuit';
  if (i === AMBASSADOR_PLAN_INDEX) return 'premium';
  const p = PLANS[i];
  if (!p) return 'gratuit';
  if (p.tier === 'manuel') return 'base';
  if (p.tier === 'assiste') return 'standard';
  return p.tier; // base | standard | premium
}
export function tierOfUser(u) { return u ? tierOfPlanIndex(u.planIndex) : 'gratuit'; }

function cleanLimit(v, d) {
  const n = parseInt(v, 10);
  if (!Number.isFinite(n)) return d;
  if (n < 0) return -1;
  return Math.min(n, 99999);
}
export async function getTierLimits(db) {
  const raw = await getSetting(db, 'tier_limits', null);
  const out = {};
  for (const t of TIER_IDS) {
    out[t] = {};
    for (const f of TIER_FEATURES) {
      out[t][f.key] = cleanLimit(raw && raw[t] && raw[t][f.key], TIER_LIMITS_DEFAULT[t][f.key]);
    }
  }
  return out;
}
export async function setTierLimits(db, limits) {
  if (!limits || typeof limits !== 'object') throw new Error('Réglages invalides.');
  const clean = {};
  for (const t of TIER_IDS) {
    clean[t] = {};
    for (const f of TIER_FEATURES) {
      const v = limits[t] && limits[t][f.key];
      const n = parseInt(v, 10);
      if (!Number.isFinite(n)) throw new Error('Nombre invalide pour « ' + f.label + ' » (' + TIER_LABELS[t] + ').');
      clean[t][f.key] = n < 0 ? -1 : Math.min(n, 99999);
    }
  }
  await setSetting(db, 'tier_limits', clean);
}

/* Clé de période d'un compteur : jour (fuseau Bénin, UTC+1) ou validité de l'abonnement en cours. */
export function tierPeriodKey(feature, user) {
  const f = TIER_FEATURES.find(x => x.key === feature);
  const shifted = new Date(Date.now() + 3600000).toISOString();
  if (f && f.unit === 'jour') return 'd:' + shifted.slice(0, 10);
  if (tierOfUser(user) === 'gratuit') return 'm:' + shifted.slice(0, 7);
  return 'v:' + (user && user.expiryTs ? user.expiryTs : 0);
}
export function tierUsageKind(feature) { return 'tier:' + feature; }

/* Limite effective d'un compte pour une fonctionnalité (-1 = illimité). Ambassadeur : illimité. */
export function tierLimitFor(limits, user, feature) {
  if (isAmbassadorUser(user)) return -1;
  const t = tierOfUser(user);
  const v = limits && limits[t] ? limits[t][feature] : undefined;
  return Number.isFinite(v) ? v : (TIER_LIMITS_DEFAULT[t][feature] ?? 0);
}

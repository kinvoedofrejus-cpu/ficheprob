import { getSetting, setSetting, normalizePhone } from './_shared.js';

/* Commandes de fiches en VERSION PAPIER (16/10/2026).
   Table « paper_orders » créée à la volée (comme « ambassadors »). Un seul réglage : le prix d'une fiche papier
   (réglé par l'admin, onglet « Commandes papier »). Tant qu'il n'est pas défini, le total est « à confirmer » et le
   client ne peut que prendre contact d'abord. */

export const PAPER_MIN_PARTIAL = 500;   // FCFA : montant minimum d'un paiement partiel
export const PAPER_STATUSES = ['nouvelle', 'confirmee', 'livree', 'annulee'];

let paperTableReady = false;
export async function ensurePaperOrdersTable(db) {
  if (paperTableReady) return;
  await db.prepare(`CREATE TABLE IF NOT EXISTS paper_orders (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    numero      TEXT,
    classe      TEXT NOT NULL,
    matieres    TEXT NOT NULL,
    nb_fiches   INTEGER NOT NULL DEFAULT 0,
    papier      TEXT,
    nb_pages    INTEGER,
    nom_fiche   TEXT NOT NULL,
    adresse     TEXT NOT NULL,
    whatsapp    TEXT NOT NULL,
    unit_price  INTEGER,
    total       INTEGER,
    paid        INTEGER NOT NULL DEFAULT 0,
    status      TEXT NOT NULL DEFAULT 'nouvelle',
    note        TEXT,
    created_at  INTEGER NOT NULL,
    updated_at  INTEGER
  )`).run();
  // Tables créées avant l'ajout du type de papier et du nombre de pages : on ajoute les colonnes (erreur ignorée si déjà là).
  for (const col of ['papier TEXT', 'nb_pages INTEGER']) {
    try { await db.prepare('ALTER TABLE paper_orders ADD COLUMN ' + col).run(); } catch (e) { /* colonne déjà présente */ }
  }
  paperTableReady = true;
}

/* Prix des fiches papier (réglés par l'admin), PAR PAGE et selon le papier : « blanc » (ram blanc) ou « couleur » (ram couleur).
     price     : prix par défaut d'une page { blanc, couleur }
     overrides : prix particuliers par classe ET matière, clé « CE1::francais » -> { blanc, couleur }
     pages     : nombre de pages fixé à la main pour une matière (sinon lu dans le .meta.json du PDF, sinon estimé)
     pagesPerFiche : estimation du nombre de pages d'une fiche, utilisée seulement quand le nombre de pages est inconnu.
   Prix ou nombre de pages manquant => total « à confirmer » (le client ne peut pas payer en ligne pour cette sélection). */
export const PAPER_TYPES = ['blanc', 'couleur'];
const posInt = x => { const n = Number(x); return Number.isFinite(n) && n > 0 ? Math.round(n) : null; };
const validKey = k => /^[^:]+::[^:]+$/.test(k);
function cleanPaperConfig(v) {
  v = v || {};
  const price = { blanc: posInt(v.price && v.price.blanc), couleur: posInt(v.price && v.price.couleur) };
  const overrides = {};
  if (v.overrides && typeof v.overrides === 'object') {
    for (const k of Object.keys(v.overrides)) {
      if (!validKey(k)) continue;
      const o = { blanc: posInt(v.overrides[k] && v.overrides[k].blanc), couleur: posInt(v.overrides[k] && v.overrides[k].couleur) };
      if (o.blanc || o.couleur) overrides[k] = o;
    }
  }
  const pages = {};
  if (v.pages && typeof v.pages === 'object') {
    for (const k of Object.keys(v.pages)) { const n = posInt(v.pages[k]); if (validKey(k) && n) pages[k] = n; }
  }
  return { price, overrides, pages, pagesPerFiche: posInt(v.pagesPerFiche) };
}
export async function getPaperConfig(db) {
  return cleanPaperConfig(await getSetting(db, 'paper_config_v2', null));
}
export async function setPaperConfig(db, cfg) {
  const clean = cleanPaperConfig(cfg);
  await setSetting(db, 'paper_config_v2', clean);
  return clean;
}
/* Prix d'une page (FCFA) pour une matière d'une classe et un papier, ou null. */
export function paperUnitPrice(cfg, classe, matiere, papier) {
  const o = cfg.overrides[classe + '::' + matiere];
  if (o && o[papier] > 0) return o[papier];
  return cfg.price[papier] > 0 ? cfg.price[papier] : null;
}
/* Nombre de pages lu dans le .meta.json déposé en R2 avec le PDF de base (champ « pageCount »). */
export async function readMetaPages(env, classe, matiere) {
  try {
    const obj = await env.FPB_IMAGES.get('readyfiche-pdfs/' + classe + '/' + matiere + '.meta.json');
    if (!obj) return null;
    return posInt(JSON.parse(await obj.text()).pageCount);
  } catch (e) { return null; }
}
/* Nombre de pages d'une matière : valeur fixée à la main > pageCount du meta > estimation (pages par fiche × fiches). */
export async function paperPagesFor(env, cfg, classe, matiere, count) {
  const manual = cfg.pages[classe + '::' + matiere];
  if (manual) return { pages: manual, source: 'manuel' };
  const m = await readMetaPages(env, classe, matiere);
  if (m) return { pages: m, source: 'meta' };
  if (cfg.pagesPerFiche && count) return { pages: cfg.pagesPerFiche * count, source: 'estimation' };
  return { pages: null, source: null };
}

export const last8 = p => normalizePhone(p).slice(-8);

/* Catalogue des Fiches Prêtes (ready-data/catalogue.js : « window.READY_CATALOGUE = {...}; ») lu côté serveur, pour que
   le nombre de fiches (donc le total) ne dépende jamais de ce que le navigateur envoie. */
export async function loadCatalogue(env, request) {
  const res = await env.ASSETS.fetch(new Request(new URL('/ready-data/catalogue.js', request.url)));
  if (!res.ok) throw new Error('Catalogue des fiches introuvable.');
  const t = await res.text();
  return JSON.parse(t.slice(t.indexOf('{'), t.lastIndexOf('}') + 1));
}

export function orderFromRow(r) {
  let matieres = [];
  try { matieres = JSON.parse(r.matieres || '[]'); } catch (e) { matieres = []; }
  const total = r.total === null || r.total === undefined ? null : Number(r.total);
  const paid = Number(r.paid) || 0;
  let paymentStatus = 'non_paye';
  if (total !== null && total > 0 && paid >= total) paymentStatus = 'solde';
  else if (paid > 0) paymentStatus = 'partiel';
  return {
    id: r.id, numero: r.numero, classe: r.classe, matieres, nbFiches: r.nb_fiches,
    papier: r.papier || null, nbPages: r.nb_pages === null || r.nb_pages === undefined ? null : Number(r.nb_pages),
    nomFiche: r.nom_fiche, adresse: r.adresse, whatsapp: r.whatsapp,
    unitPrice: r.unit_price === null || r.unit_price === undefined ? null : Number(r.unit_price),
    total, paid, reste: total === null ? null : Math.max(0, total - paid),
    status: r.status, paymentStatus, note: r.note || '',
    createdAt: r.created_at, updatedAt: r.updated_at || null
  };
}
/* Version renvoyée au client : sans identifiant interne ni note de l'équipe. */
export function publicOrder(o) {
  const { id, note, ...rest } = o;
  return rest;
}

export async function findOrderRow(db, numero, whatsapp) {
  const n = String(numero || '').trim().toUpperCase().replace(/\s+/g, '');
  if (!n || last8(whatsapp).length < 8) return null;
  await ensurePaperOrdersTable(db);
  const row = await db.prepare('SELECT * FROM paper_orders WHERE UPPER(numero) = ? ORDER BY id DESC LIMIT 1').bind(n).first();
  if (!row || last8(row.whatsapp) !== last8(whatsapp)) return null;
  return row;
}

/* Paiement confirmé (webhook FedaPay) ou enregistré à la main par l'admin : s'ajoute au montant déjà payé. */
export async function applyPaperPayment(db, orderId, amount) {
  await ensurePaperOrdersTable(db);
  const a = Math.round(Number(amount));
  if (!Number.isFinite(a) || a <= 0) return;
  await db.prepare(`UPDATE paper_orders
    SET paid = paid + ?, status = CASE WHEN status = 'nouvelle' THEN 'confirmee' ELSE status END, updated_at = ?
    WHERE id = ?`).bind(a, Date.now(), Number(orderId)).run();
}

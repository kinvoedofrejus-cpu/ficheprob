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
  paperTableReady = true;
}

export async function getPaperConfig(db) {
  const v = await getSetting(db, 'paper_config', null);
  const p = v ? Number(v.pricePerFiche) : NaN;
  return { pricePerFiche: Number.isFinite(p) && p > 0 ? Math.round(p) : null };
}
export async function setPaperConfig(db, pricePerFiche) {
  const n = Number(pricePerFiche);
  const clean = Number.isFinite(n) && n > 0 ? Math.round(n) : null;
  await setSetting(db, 'paper_config', { pricePerFiche: clean });
  return { pricePerFiche: clean };
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

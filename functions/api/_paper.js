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
  for (const col of ['papier TEXT', 'nb_pages INTEGER', 'pay_mode TEXT', 'manual_declared INTEGER', 'proof_key TEXT', 'proof_at INTEGER', 'kind TEXT']) {
    try { await db.prepare('ALTER TABLE paper_orders ADD COLUMN ' + col).run(); } catch (e) { /* colonne déjà présente */ }
  }
  paperTableReady = true;
}

/* (Ancien système, n'est plus utilisé pour le total — voir paperBilling ci-dessus.) Prix des fiches papier (réglés par l'admin), PAR PAGE et selon le papier : « blanc » (ram blanc) ou « couleur » (ram couleur).
     price     : prix par défaut d'une page { blanc, couleur }
     overrides : prix particuliers par classe ET matière, clé « CE1::francais » -> { blanc, couleur }
     pages     : nombre de pages fixé à la main pour une matière (sinon lu dans le .meta.json du PDF, sinon estimé)
     pagesPerFiche : estimation du nombre de pages d'une fiche, utilisée seulement quand le nombre de pages est inconnu.
   Prix ou nombre de pages manquant => total « à confirmer » (le client ne peut pas payer en ligne pour cette sélection). */
export const PAPER_TYPES = ['blanc', 'couleur'];

/* IMPRESSION CARTONNÉE des RÉSUMÉS + RESSOURCES DIDACTIQUES (19/10/2026) — même table « paper_orders » (kind = 'resumes').
   Tarif dégressif (19/10/2026) : 1 classe 5 000 F · 2 classes 7 500 F · 3 classes 10 000 F · (4 classes 12 500 F · 5 classes 15 000 F,
   même progression de +2 500 F par classe) · toutes les classes (CI à CM2) 15 200 F (plafond). Le total est TOUJOURS recalculé ici. */
export const PRINT_RESUME_CLASSES = ['CI', 'CP', 'CE1', 'CE2', 'CM1', 'CM2'];
export const PRINT_RESUME_CLASS_PRICE = 5000;   // première classe
export const PRINT_RESUME_EXTRA_CLASS_PRICE = 2500; // chaque classe supplémentaire
export const PRINT_RESUME_ALL_PRICE = 15200;
export function printResumesTotal(nbClasses) {
  const n = Math.round(Number(nbClasses));
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.min(PRINT_RESUME_CLASS_PRICE + (n - 1) * PRINT_RESUME_EXTRA_CLASS_PRICE, PRINT_RESUME_ALL_PRICE);
}

/* FORMULE DE PRIX (18/10/2026) — remplace les prix par page de l'admin :
     pages facturées = nombre exact de pages arrondi à la CENTAINE SUPÉRIEURE (1220 → 1300)
     prix = 20 F par page (impression) + prix de la ram × nombre de rames de 500 pages (arrondi au-dessus)
     ram blanc : 2 500 F les 500 pages ; ram couleur : 5 000 F les 500 pages.
   Ex. 1300 pages : 20×1300 + 2500×3 = 33 500 F (blanc) ; 20×1300 + 5000×3 = 41 000 F (couleur). */
export const PAPER_PRINT_PER_PAGE = 20;
export const PAPER_REAM_PAGES = 500;
export const PAPER_REAM_PRICE = { blanc: 2500, couleur: 5000 };
export function paperBilling(exactPages, papier) {
  const n = Math.round(Number(exactPages));
  if (!Number.isFinite(n) || n <= 0 || !PAPER_REAM_PRICE[papier]) return null;
  const pages = Math.ceil(n / 100) * 100;
  const reams = Math.ceil(pages / PAPER_REAM_PAGES);
  const print = PAPER_PRINT_PER_PAGE * pages;
  const paper = PAPER_REAM_PRICE[papier] * reams;
  return { exact: n, pages, reams, print, paper, total: print + paper };
}
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
/* ---------- COMPTAGE AUTOMATIQUE DES PAGES (19/10/2026) ----------
   Quand ni le nombre de pages saisi à la main ni le .meta.json n'existent, l'application compte elle-même les pages dans
   le PDF de base de la matière (R2 : readyfiche-pdfs/{classe}/{matiere}.pdf). Le résultat est mis en cache (clé = taille +
   etag du fichier) : le PDF n'est relu que s'il est remplacé. Aucune bibliothèque : lecture de l'arbre de pages du PDF,
   y compris quand il est rangé dans des flux compressés (PDF modernes). */
async function inflateBytes(u8) {
  const ds = new DecompressionStream('deflate');
  const w = ds.writable.getWriter();
  w.write(u8); w.close();
  return new Uint8Array(await new Response(ds.readable).arrayBuffer());
}
function scanPdfText(t) {
  let best = 0, leaves = 0, m;
  const reP = /\/Type\s*\/Pages(?![A-Za-z])/g;
  while ((m = reP.exec(t))) {
    const w = t.slice(Math.max(0, m.index - 400), m.index + 700);
    const c = [...w.matchAll(/\/Count\s+(\d+)/g)];
    if (c.length) {
      // le /Count le plus proche de « /Type /Pages » : celui du même dictionnaire
      let nearest = null, nd = 1e9;
      for (const x of c) { const d = Math.abs(x.index - (m.index - Math.max(0, m.index - 400))); if (d < nd) { nd = d; nearest = x; } }
      best = Math.max(best, parseInt(nearest[1], 10));
    }
  }
  const reL = /\/Type\s*\/Page(?![A-Za-z])/g;
  while (reL.exec(t)) leaves++;
  return { best, leaves };
}
export async function countPdfPages(buf) {
  const u8 = new Uint8Array(buf);
  const td = new TextDecoder('latin1');
  const txt = td.decode(u8);
  let { best, leaves } = scanPdfText(txt);
  if (!best) {
    // Arbre de pages éventuellement rangé dans des flux d'objets compressés (/ObjStm)
    const reO = /\/Type\s*\/ObjStm[\s\S]{0,400}?stream\r?\n/g;
    let m;
    while ((m = reO.exec(txt))) {
      const start = m.index + m[0].length;
      const end = txt.indexOf('endstream', start);
      if (end < 0) continue;
      // Le retour à la ligne avant « endstream » ne fait pas partie des données compressées : on essaie sans, puis avec.
      let e1 = end;
      if (u8[e1 - 1] === 10) e1--;
      if (u8[e1 - 1] === 13) e1--;
      for (const e of (e1 === end ? [end] : [e1, end])) {
        try {
          const dec = td.decode(await inflateBytes(u8.subarray(start, e)));
          const r = scanPdfText(dec);
          best = Math.max(best, r.best); leaves += r.leaves;
          break;
        } catch (err) { /* flux illisible : on essaie l'autre découpage */ }
      }
    }
  }
  return best || leaves || null;
}
const PAGES_CACHE_KEY = 'paper_pages_cache_v1';
async function pdfPagesCounted(env, classe, matiere) {
  const key = 'readyfiche-pdfs/' + classe + '/' + matiere + '.pdf';
  try {
    const head = await env.FPB_IMAGES.head(key);
    if (!head) return null;
    const sig = String(head.size) + ':' + (head.etag || '');
    const cache = (await getSetting(env.FPB_DB, PAGES_CACHE_KEY, null)) || {};
    const k = classe + '::' + matiere;
    if (cache[k] && cache[k].sig === sig && cache[k].pages > 0) return cache[k].pages;
    if (head.size > 80 * 1024 * 1024) return null;
    const obj = await env.FPB_IMAGES.get(key);
    if (!obj) return null;
    const pages = await countPdfPages(await obj.arrayBuffer());
    if (!pages) return null;
    cache[k] = { pages, sig };
    await setSetting(env.FPB_DB, PAGES_CACHE_KEY, cache);
    return pages;
  } catch (e) { return null; }
}
async function pdfPagesCached(env, classe, matiere) {
  try {
    const cache = (await getSetting(env.FPB_DB, PAGES_CACHE_KEY, null)) || {};
    const c = cache[classe + '::' + matiere];
    return c && c.pages > 0 ? c.pages : null;
  } catch (e) { return null; }
}
/* Nombre de pages d'une matière : valeur fixée à la main > pageCount du meta > comptage réel du PDF (mis en cache) > estimation.
   countPdf = true : lit et compte le PDF s'il n'est pas encore en cache (commande, ou demande de comptage du client). */
export async function paperPagesFor(env, cfg, classe, matiere, count, opts) {
  const manual = cfg.pages[classe + '::' + matiere];
  if (manual) return { pages: manual, source: 'manuel' };
  const m = await readMetaPages(env, classe, matiere);
  if (m) return { pages: m, source: 'meta' };
  const counted = (opts && opts.countPdf) ? await pdfPagesCounted(env, classe, matiere) : await pdfPagesCached(env, classe, matiere);
  if (counted) return { pages: counted, source: 'pdf' };
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
    kind: r.kind || 'fiches', hasProof: !!r.proof_key, proofAt: r.proof_at ? Number(r.proof_at) : null,
    payMode: r.pay_mode || null, manualDeclared: r.manual_declared ? Number(r.manual_declared) : null,
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

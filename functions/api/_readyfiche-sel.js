import { getTx, hashGuestToken } from './_shared.js';

/* « Regrouper quelques fiches » (novembre 2026) : l'enseignant choisit des TITRES parmi les fiches prêtes et paie par LOT.
   Tarif : 325 F par lot de 25 fiches (1 à 25 = 325 F ; 26 à 50 = 650 F ; 51 à 75 = 975 F ; etc.).
   Le droit est porté par la transaction (type « readyfichesel », jeton secret de l'appareil, comme l'achat sans compte) ;
   la liste des fiches choisies et le nom à imprimer sont rangés dans la table readyfiche_selections. */
export const SEL_LOT_SIZE = 25;
export const SEL_LOT_PRICE = 325;      // FCFA par lot de 25 fiches
export const SEL_MAX_ITEMS = 1000;
export const SEL_MAX_DOWNLOADS = 3;    // le PDF peut être re-téléchargé 3 fois (échec réseau, nouveau téléphone…)

export function selPrice(n) { return Math.ceil(Math.max(0, n) / SEL_LOT_SIZE) * SEL_LOT_PRICE; }

export async function ensureSelTable(db) {
  await db.prepare(`CREATE TABLE IF NOT EXISTS readyfiche_selections (
    tx_id TEXT PRIMARY KEY, classe TEXT, items TEXT, name TEXT, n INTEGER,
    downloads INTEGER DEFAULT 0, created_at INTEGER)`).run();
}

export async function getSelection(db, txId) {
  await ensureSelTable(db);
  const row = await db.prepare('SELECT * FROM readyfiche_selections WHERE tx_id = ?').bind(String(txId)).first();
  if (!row) return null;
  let items = [];
  try { items = JSON.parse(row.items || '[]'); } catch (e) { items = []; }
  return { txId: row.tx_id, classe: row.classe, items, name: row.name || '', n: row.n || items.length, downloads: row.downloads || 0 };
}

/* Droit de récupérer le PDF de base d'UNE matière pour cette sélection : transaction payée + jeton + matière choisie. */
export async function checkSelectionAccess(db, txId, token, classe, matiere) {
  if (!txId || !token || String(token).length < 16 || !classe || !matiere) return { ok: false, reason: 'invalid', status: 400 };
  const tx = await getTx(db, txId);
  if (!tx || tx.type !== 'readyfichesel') return { ok: false, reason: 'invalid', status: 401 };
  if ((await hashGuestToken(token)) !== tx.code) return { ok: false, reason: 'invalid', status: 401 };
  if (tx.status !== 'paid' || tx.classe !== classe) return { ok: false, reason: 'notpurchased', status: 403 };
  const sel = await getSelection(db, txId);
  if (!sel || !sel.items.some(x => x.m === matiere)) return { ok: false, reason: 'notpurchased', status: 403 };
  if (sel.downloads >= SEL_MAX_DOWNLOADS) return { ok: false, reason: 'alreadydownloaded', status: 409 };
  return { ok: true, tx, sel };
}

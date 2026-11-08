import {
  requireAdmin, json,
  ensureSettingsTable, ensureAmbassadorsTable, ensureSuggestionsTable, ensureDownloadTables
} from './_shared.js';
import { ensurePaperOrdersTable } from './_paper.js';
import { ensureCustomResourcesTable } from './_customres.js';

// Cloudflare Function — /api/admin-restore-db   (novembre 2026)
// Bouton « Restaurer » de l'admin (onglet Sauvegarde) : remet dans la base D1 les lignes d'une table qui figurent dans
// un zip de sauvegarde (fichiers base/<table>.json). Remplace les commandes « wrangler d1 execute ».
//
// POST JSON : { token, table, rows:[{colonne:valeur,…}], overwrite }
//   overwrite = true  → INSERT OR REPLACE : la ligne de la sauvegarde remplace celle qui existe (même clé) ;
//   overwrite = false → INSERT OR IGNORE  : on ne remet que les lignes manquantes (mode sûr, par défaut côté interface).
// Aucune ligne n'est jamais supprimée. Seules les tables de la sauvegarde sont acceptées, et seules les colonnes
// réellement présentes dans la table sont écrites.
// Réponse : { ok:true, table, received, written }   ou   { ok:true, table, skipped:'table-absente' }
const TABLES = [
  'resumes', 'hidden_matieres', 'hidden_classes', 'custom_resources',
  'users', 'transactions', 'readyfiche_purchases', 'readyfiche_downloads', 'resume_purchases', 'resume_downloads',
  'resource_purchases', 'first_downloads', 'download_usage', 'download_credits', 'settings', 'promos',
  'ambassadors', 'suggestions', 'paper_orders', 'account_emails', 'admin_downloads'
];
const BATCH = 40;          // lignes par lot D1
const MAX_ROWS = 2000;     // lignes par appel

async function ensureTable(db, table) {
  if (table === 'settings') await ensureSettingsTable(db);
  else if (table === 'ambassadors') await ensureAmbassadorsTable(db);
  else if (table === 'suggestions') await ensureSuggestionsTable(db);
  else if (table === 'download_usage' || table === 'download_credits') await ensureDownloadTables(db);
  else if (table === 'paper_orders') await ensurePaperOrdersTable(db);
  else if (table === 'custom_resources') await ensureCustomResourcesTable(db);
  else if (table === 'account_emails') {
    await db.prepare('CREATE TABLE IF NOT EXISTS account_emails (phone TEXT PRIMARY KEY, email TEXT NOT NULL, verified_at INTEGER)').run();
  } else if (table === 'admin_downloads') {
    await db.prepare(`CREATE TABLE IF NOT EXISTS admin_downloads (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      phone TEXT, kind TEXT, classe TEXT, matiere TEXT, format TEXT, nom TEXT, filigrane INTEGER, created_at INTEGER
    )`).run();
  }
}

export async function onRequestPost(context) {
  const { request, env } = context;
  const db = env.FPB_DB;
  try {
    const body = await request.json().catch(() => ({}));
    if (!(await requireAdmin(env, body.token))) return json({ ok: false, reason: 'invalid' }, 401);

    const table = String(body.table || '');
    if (!TABLES.includes(table)) return json({ ok: false, reason: 'invalid-table' }, 400);
    const rows = Array.isArray(body.rows) ? body.rows : null;
    if (!rows) return json({ ok: false, reason: 'invalid-rows' }, 400);
    if (rows.length > MAX_ROWS) return json({ ok: false, reason: 'too-many-rows' }, 413);
    const overwrite = body.overwrite === true || body.overwrite === '1' || body.overwrite === 1;

    await ensureTable(db, table);

    let info;
    try {
      info = await db.prepare(`PRAGMA table_info(${table})`).all();
    } catch (e) { info = { results: [] }; }
    const known = new Set(((info && info.results) || []).map(c => c.name));
    if (!known.size) return json({ ok: true, table, received: rows.length, written: 0, skipped: 'table-absente' });

    const verb = overwrite ? 'INSERT OR REPLACE' : 'INSERT OR IGNORE';
    let written = 0;
    for (let i = 0; i < rows.length; i += BATCH) {
      const stmts = [];
      for (const row of rows.slice(i, i + BATCH)) {
        if (!row || typeof row !== 'object') continue;
        const cols = Object.keys(row).filter(c => known.has(c) && /^[A-Za-z_][A-Za-z0-9_]*$/.test(c));
        if (!cols.length) continue;
        const vals = cols.map(c => {
          const v = row[c];
          if (v === null || v === undefined) return null;
          if (typeof v === 'object') return JSON.stringify(v);
          if (typeof v === 'boolean') return v ? 1 : 0;
          return v;
        });
        stmts.push(db.prepare(`${verb} INTO ${table} (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`).bind(...vals));
      }
      if (!stmts.length) continue;
      const res = await db.batch(stmts);
      for (const r of res) written += (r && r.meta && r.meta.changes) || 0;
    }
    return json({ ok: true, table, received: rows.length, written });
  } catch (err) {
    return json({ error: 'Erreur lors de la restauration : ' + err.message }, 500);
  }
}

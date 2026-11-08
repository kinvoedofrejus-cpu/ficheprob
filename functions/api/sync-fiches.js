/*
  Synchronisation de l'historique des fiches (novembre 2026).

  Chaque fiche d'un compte est stockée dans la table D1 « fiches_sync » (une ligne par fiche).
  Table créée au besoin (CREATE TABLE IF NOT EXISTS) : aucune migration à lancer.

  POST /api/sync-fiches
    { phone, code, since, changes: [ { id, updatedAt, deleted?, data? } ] }
  Réponse
    { ok, items: [ { id, updatedAt, deleted, data } ], cursor, more }

  - Résolution des conflits : la version avec le plus grand updatedAt gagne (par fiche).
  - Le curseur « since » est basé sur une horloge SERVEUR (synced_at), pas sur l'horloge des téléphones :
    un téléphone dont l'heure est décalée ne peut donc pas faire « manquer » des fiches aux autres appareils.
  - Une fiche supprimée est conservée comme « pierre tombale » (deleted=1) pour se propager aux autres appareils.
*/
import { normalizePhone, json, getUser } from './_shared.js';

const OWNER_PHONE_HARDCODED = '0166661846';
const OWNER_CODE_HARDCODED = 'KINVOS';

const MAX_CHANGES_PER_CALL = 40;
const MAX_FICHE_BYTES = 700 * 1024;   // une ligne D1 ne doit pas dépasser ~2 Mo
const MAX_ROWS_PER_PHONE = 3000;
const PAGE_SIZE = 25;

let tableReady = false;
async function ensureTable(db) {
  if (tableReady) return;
  await db.prepare(`CREATE TABLE IF NOT EXISTS fiches_sync (
    phone      TEXT NOT NULL,
    id         TEXT NOT NULL,
    data       TEXT,
    updated_at INTEGER NOT NULL,
    synced_at  INTEGER NOT NULL,
    deleted    INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (phone, id)
  )`).run();
  await db.prepare('CREATE INDEX IF NOT EXISTS idx_fiches_sync_cursor ON fiches_sync (phone, synced_at)').run();
  tableReady = true;
}

export async function onRequestPost(context) {
  const { request, env } = context;
  const db = env.FPB_DB;
  try {
    const body = await request.json();
    const phone = normalizePhone(body.phone);
    const code = (body.code || '').trim().toUpperCase();
    if (phone.length < 8 || !code) return json({ ok: false, reason: 'invalid' }, 400);

    // Authentification : même principe que record-usage (numéro + code d'accès).
    const isOwner = phone === normalizePhone(OWNER_PHONE_HARDCODED) && code === OWNER_CODE_HARDCODED;
    if (!isOwner) {
      const record = await getUser(db, phone);
      if (!record || (record.code || '').toUpperCase() !== code) return json({ ok: false, reason: 'invalid' }, 401);
      if (!record.active) return json({ ok: false, reason: 'inactive' }, 403);
      // Pas de contrôle d'expiration : l'enseignant doit toujours pouvoir retrouver ses propres fiches.
    }

    await ensureTable(db);

    const since = Number(body.since) || 0;
    const changes = Array.isArray(body.changes) ? body.changes.slice(0, MAX_CHANGES_PER_CALL) : [];
    const rejected = [];

    if (changes.length) {
      const countRow = await db.prepare('SELECT COUNT(*) AS n FROM fiches_sync WHERE phone = ?').bind(phone).first();
      let rowCount = (countRow && countRow.n) || 0;
      const base = Date.now() * 1000;
      const stmts = [];
      changes.forEach((c, i) => {
        const id = String((c && c.id) || '').slice(0, 80);
        const updatedAt = Number(c && c.updatedAt) || 0;
        if (!id || !updatedAt) return;
        const deleted = c.deleted ? 1 : 0;
        let dataStr = null;
        if (!deleted) {
          try { dataStr = JSON.stringify(c.data); } catch (e) { dataStr = null; }
          if (!dataStr || dataStr.length > MAX_FICHE_BYTES) { rejected.push(id); return; }
          if (rowCount >= MAX_ROWS_PER_PHONE) { rejected.push(id); return; }
          rowCount++;
        }
        stmts.push(db.prepare(`
          INSERT INTO fiches_sync (phone, id, data, updated_at, synced_at, deleted)
          VALUES (?,?,?,?,?,?)
          ON CONFLICT(phone, id) DO UPDATE SET
            data = excluded.data, updated_at = excluded.updated_at,
            synced_at = excluded.synced_at, deleted = excluded.deleted
          WHERE excluded.updated_at > fiches_sync.updated_at
        `).bind(phone, id, dataStr, updatedAt, base + i, deleted));
      });
      if (stmts.length) await db.batch(stmts);
    }

    const rows = await db.prepare(`
      SELECT id, data, updated_at, synced_at, deleted FROM fiches_sync
      WHERE phone = ? AND synced_at > ? ORDER BY synced_at ASC LIMIT ?
    `).bind(phone, since, PAGE_SIZE).all();
    const list = (rows && rows.results) || [];

    const items = list.map(r => {
      let data = null;
      if (!r.deleted && r.data) { try { data = JSON.parse(r.data); } catch (e) { data = null; } }
      return { id: r.id, updatedAt: r.updated_at, deleted: !!r.deleted, data };
    });
    const cursor = list.length ? list[list.length - 1].synced_at : since;

    return json({ ok: true, items, cursor, more: list.length === PAGE_SIZE, rejected });
  } catch (err) {
    return json({ error: 'Erreur de synchronisation : ' + err.message }, 500);
  }
}

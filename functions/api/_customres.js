/* Ressources « Autres » : documents PDF déposés librement par l'administrateur (aucun type / niveau imposé).
   Le PDF est rangé dans R2 sous resource-pdfs/{id}.pdf (comme les autres ressources didactiques) et son titre dans D1.
   Les identifiants commencent toujours par « autres- ». */
export const CUSTOM_RES_PREFIX = 'autres-';

export async function ensureCustomResourcesTable(db) {
  await db.prepare(`CREATE TABLE IF NOT EXISTS custom_resources (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    size INTEGER,
    created_at INTEGER
  )`).run();
}

export async function listCustomResources(db) {
  await ensureCustomResourcesTable(db);
  const { results } = await db.prepare('SELECT id, title, size, created_at FROM custom_resources ORDER BY created_at DESC, id DESC').all();
  return (results || []).map(r => ({ id: r.id, title: r.title, size: Number(r.size) || 0, createdAt: Number(r.created_at) || 0 }));
}

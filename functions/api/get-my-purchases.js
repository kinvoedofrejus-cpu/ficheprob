import { json, ensureDownloadTables, resolveOwner, DEM_ALL_RESOURCE_ID } from './_shared.js';

/* Cloudflare Function — /api/get-my-purchases   (rubrique « Mes achats », novembre 2026)
   Liste ce que le visiteur ou le compte a débloqué dans « resource_purchases » : ressources, forfaits « tous les niveaux »,
   cahiers d'expression écrite et forfait « toutes les démarches ». Les déblocages gratuits (tx_id = 'free') sont exclus.
   Body : { phone?, code?, deviceId }   →   { ok, items: [{ type, ref, label?, group?, classe?, purchasedAt, included }] }
   type : 'resource' | 'group' | 'ee' | 'dem'. Le propriétaire est reconnu par son appareil/compte comme n'importe qui. */
export async function onRequestPost(context) {
  const { request, env } = context;
  const db = env.FPB_DB;
  try {
    const { phone, code, deviceId } = await request.json();
    await ensureDownloadTables(db);
    const who = await resolveOwner(db, { phone, code, deviceId });
    if (!who.owner) return json({ ok: false, reason: 'invalid' }, 400);
    let rows = { results: [] };
    try {
      rows = await db.prepare(
        "SELECT resource_id, purchased_at, tx_id FROM resource_purchases WHERE phone = ? AND (tx_id IS NULL OR tx_id <> 'free') ORDER BY purchased_at DESC LIMIT 200"
      ).bind(who.owner).all();
    } catch (e) {
      if (!/no such table/i.test(String(e && e.message))) throw e;   // table pas encore créée : aucun achat à lister
    }
    const items = [];
    for (const r of (rows.results || [])) {
      const id = String(r.resource_id || '');
      const base = { purchasedAt: r.purchased_at || 0, included: r.tx_id === 'tier' };
      if (id.startsWith('cahier-ee:')) items.push({ ...base, type: 'ee', ref: id, classe: id.slice('cahier-ee:'.length) });
      else if (id === DEM_ALL_RESOURCE_ID) items.push({ ...base, type: 'dem', ref: id });
      else if (id.startsWith('all:')) items.push({ ...base, type: 'group', ref: id, group: id.slice(4) });
      else if (id) items.push({ ...base, type: 'resource', ref: id });
    }
    return json({ ok: true, items });
  } catch (err) {
    return json({ ok: false, error: 'Erreur : ' + err.message }, 500);
  }
}

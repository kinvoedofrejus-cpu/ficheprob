import { requireAdmin, json } from './_shared.js';

/* Admin : { token, id } → capture de paiement d'une commande papier, renvoyée en data-URL pour l'afficher dans le dashboard. */
export async function onRequestPost(context) {
  const { request, env } = context;
  try {
    const b = await request.json();
    if (!(await requireAdmin(env, b.token))) return json({ error: 'Non autorisé' }, 401);
    const row = await env.FPB_DB.prepare('SELECT proof_key FROM paper_orders WHERE id = ?').bind(Number(b.id)).first();
    if (!row || !row.proof_key) return json({ error: 'Aucune capture pour cette commande.' }, 404);
    const obj = await env.FPB_IMAGES.get(row.proof_key);
    if (!obj) return json({ error: 'Capture introuvable dans le stockage.' }, 404);
    const buf = new Uint8Array(await obj.arrayBuffer());
    let bin = '';
    for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode.apply(null, buf.subarray(i, i + 0x8000));
    const type = (obj.httpMetadata && obj.httpMetadata.contentType) || 'image/jpeg';
    return json({ ok: true, dataUrl: 'data:' + type + ';base64,' + btoa(bin) });
  } catch (err) {
    return json({ error: 'Erreur : ' + err.message }, 500);
  }
}

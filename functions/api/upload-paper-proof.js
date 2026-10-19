import { json } from './_shared.js';
import { ensurePaperOrdersTable, findOrderRow } from './_paper.js';

/* Cloudflare Function — /api/upload-paper-proof (public)
   Capture d'écran du paiement manuel (dépôt MTN) d'une commande papier. Corps multipart : numero, whatsapp, image.
   Le numéro de commande ET le numéro WhatsApp doivent correspondre. L'image (déjà réduite côté navigateur) est
   rangée dans R2 sous paper-proofs/<numero>.<ext> ; un nouvel envoi remplace le précédent. */
const MAX_SIZE = 4 * 1024 * 1024;

export async function onRequestPost(context) {
  const { request, env } = context;
  const db = env.FPB_DB;
  try {
    const fd = await request.formData();
    const file = fd.get('image');
    const row = await findOrderRow(db, fd.get('numero'), fd.get('whatsapp'));
    if (!row) return json({ error: 'Commande introuvable.' }, 404);
    if (!file || typeof file === 'string') return json({ error: 'Aucune image reçue.' }, 400);
    if (!file.type || !file.type.startsWith('image/')) return json({ error: 'Le fichier doit être une image.' }, 400);
    if (file.size > MAX_SIZE) return json({ error: 'Image trop lourde (4 Mo maximum).' }, 413);

    const ext = (file.type.split('/')[1] || 'jpg').replace(/[^a-z0-9]/gi, '') || 'jpg';
    const key = `paper-proofs/${row.numero}.${ext}`;
    if (row.proof_key && row.proof_key !== key) { try { await env.FPB_IMAGES.delete(row.proof_key); } catch (e) { /* ancien fichier déjà absent */ } }
    await env.FPB_IMAGES.put(key, file.stream(), { httpMetadata: { contentType: file.type } });
    await ensurePaperOrdersTable(db);
    await db.prepare('UPDATE paper_orders SET proof_key = ?, proof_at = ?, updated_at = ? WHERE id = ?').bind(key, Date.now(), Date.now(), row.id).run();
    return json({ ok: true });
  } catch (err) {
    return json({ error: "Erreur lors de l'envoi de la capture : " + err.message }, 500);
  }
}

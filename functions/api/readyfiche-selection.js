import { json, getTx, hashGuestToken } from './_shared.js';
import { getSelection, ensureSelTable, SEL_MAX_DOWNLOADS } from './_readyfiche-sel.js';

// Cloudflare Function — /api/readyfiche-selection  (POST { action:'get'|'done', txId, guestToken })
//   get  : renvoie la sélection payée (fiches choisies, nom à imprimer, téléchargements restants)
//   done : compte un téléchargement réussi (appelé par l'app une fois le PDF réellement enregistré)
export async function onRequestPost(context) {
  const { request, env } = context;
  const db = env.FPB_DB;
  try {
    const { action, txId, guestToken } = await request.json().catch(() => ({}));
    if (!txId || typeof guestToken !== 'string' || guestToken.length < 16) return json({ ok: false, reason: 'invalid' }, 400);
    const tx = await getTx(db, txId);
    if (!tx || tx.type !== 'readyfichesel' || (await hashGuestToken(guestToken)) !== tx.code) return json({ ok: false, reason: 'invalid' }, 401);
    if (tx.status !== 'paid') return json({ ok: true, status: tx.status });
    const sel = await getSelection(db, txId);
    if (!sel) return json({ ok: false, reason: 'notfound' }, 404);
    if (action === 'done') {
      if (sel.downloads < SEL_MAX_DOWNLOADS) {
        await ensureSelTable(db);
        await db.prepare('UPDATE readyfiche_selections SET downloads = downloads + 1 WHERE tx_id = ?').bind(String(txId)).run();
        sel.downloads += 1;
      }
    }
    return json({ ok: true, status: 'paid', classe: sel.classe, items: sel.items, name: sel.name, n: sel.n, remaining: Math.max(0, SEL_MAX_DOWNLOADS - sel.downloads) });
  } catch (err) {
    return json({ error: 'Erreur : ' + err.message }, 500);
  }
}

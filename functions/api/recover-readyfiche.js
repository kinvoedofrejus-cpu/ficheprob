import { json, getTx, upsertTx, getSetting, setSetting, hashGuestToken, guestDownloadKey, getReadyFicheDownloads, readyFormatOfTx } from './_shared.js';

/* Cloudflare Function — /api/recover-readyfiche  (29/10/2026) — public
   « J'ai perdu mon achat » : l'acheteur saisit le n° de transaction + le code de récupération reçu de l'admin
   (voir admin-readyfiche-recovery.js) ; son achat est alors rattaché au NOUVEAU jeton de son appareil (l'ancien ne marche plus).
   Le n° de transaction seul ne suffit jamais (il est devinable) : sans code valide, rien n'est modifié.
   5 essais ratés = code annulé ; code à usage unique, valable 7 jours. */
export async function onRequestPost(context) {
  const { request, env } = context;
  const db = env.FPB_DB;
  const bad = (status = 400) => json({ ok: false, reason: 'invalid', error: 'N° de transaction ou code incorrect (ou code expiré).' }, status);
  try {
    const { txId, code, guestToken } = await request.json();
    const id = String(txId || '').trim();
    const cleanCode = String(code || '').trim().toUpperCase().replace(/[\s-]/g, '');
    if (!id || cleanCode.length < 6 || typeof guestToken !== 'string' || guestToken.length < 16 || guestToken.length > 128) return bad();

    const key = 'readyfiche_recovery:' + id;
    const rec = await getSetting(db, key, null);
    if (!rec || !rec.hash || Date.now() > Number(rec.expires || 0)) return bad(403);

    if ((await hashGuestToken(cleanCode)) !== rec.hash) {
      const tries = Number(rec.tries || 0) + 1;
      if (tries >= 5) await setSetting(db, key, { hash: '', expires: 0, tries });   // annulé : l'admin doit en générer un autre
      else await setSetting(db, key, { ...rec, tries });
      return bad(403);
    }

    const tx = await getTx(db, id);
    if (!tx || tx.type !== 'readyfiche' || tx.tier !== 'guest' || tx.status !== 'paid') return bad(404);

    await upsertTx(db, tx.id, { ...tx, code: await hashGuestToken(guestToken) });   // l'achat appartient désormais à ce nouvel appareil
    await setSetting(db, key, { hash: '', expires: 0, tries: 0 });                  // usage unique

    const done = (await getReadyFicheDownloads(db, guestDownloadKey(tx.id))).filter(d => d.classe === tx.classe).map(d => d.matiere);
    return json({
      ok: true, txId: tx.id, classe: tx.classe, matiere: tx.matiere, format: readyFormatOfTx(tx),
      done, consumed: tx.matiere !== '*' && done.includes(tx.matiere)
    });
  } catch (err) {
    return json({ error: 'Erreur : ' + err.message }, 500);
  }
}

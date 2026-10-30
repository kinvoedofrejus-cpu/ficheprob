import { normalizePhone, json, getUser, getReadyFichePurchases, getReadyFicheDownloads, getTx, hashGuestToken, guestDownloadKey, hasReadyFicheDownload, readyFormatOfTx, getReadyVersions, readyUpdateAvailable } from './_shared.js';

const OWNER_PHONE_HARDCODED = '0166661846';
const OWNER_CODE_HARDCODED = 'KINVOS';

export async function onRequestPost(context) {
  const { request, env } = context;
  const db = env.FPB_DB;
  try {
    const body = await request.json();
    // Achats SANS compte : l'appareil envoie la liste [{txId, token}] de ses achats.
    if (Array.isArray(body.guest)) {
      const versions = await getReadyVersions(db);
      const out = [];
      for (const g of body.guest.slice(0, 60)) {
        const r = { txId: String(g && g.txId), status: 'unknown', consumed: false };
        const tx = g && g.txId ? await getTx(db, g.txId) : null;
        if (tx && tx.type === 'readyfiche' && tx.tier === 'guest' && (await hashGuestToken(g.token)) === tx.code) {
          r.status = tx.status === 'paid' ? 'paid' : (tx.status === 'failed' ? 'failed' : 'pending');
          r.classe = tx.classe; r.matiere = tx.matiere; r.format = readyFormatOfTx(tx);
          r.amount = tx.amount; r.paidAt = tx.paidAt || tx.createdAt; r.upd = [];
          if (r.status === 'paid') {
            const done = await getReadyFicheDownloads(db, guestDownloadKey(tx.id));
            if (tx.matiere === '*') {
              r.done = done.filter(d => d.classe === tx.classe).map(d => d.matiere);   // forfait classe : matières déjà téléchargées
              r.upd = done.filter(d => d.classe === tx.classe && readyUpdateAvailable(versions, d.classe, d.matiere, d.downloadedAt)).map(d => d.matiere);   // version corrigée disponible
            } else {
              r.consumed = hasReadyFicheDownload(done, tx.classe, tx.matiere);
              const prev = done.find(d => d.classe === tx.classe && d.matiere === tx.matiere);
              if (prev && readyUpdateAvailable(versions, prev.classe, prev.matiere, prev.downloadedAt)) r.upd = [tx.matiere];
            }
          }
        }
        out.push(r);
      }
      return json({ ok: true, guest: out });
    }
    const { phone, code } = body;
    const phoneDigits = normalizePhone(phone);
    const cleanCode = (code || '').trim().toUpperCase();
    if (phoneDigits.length < 8 || !cleanCode) return json({ ok: false, reason: 'invalid' }, 400);

    if (phoneDigits === normalizePhone(OWNER_PHONE_HARDCODED) && cleanCode === OWNER_CODE_HARDCODED) {
      return json({ ok: true, purchases: [], downloads: [] });
    }

    const record = await getUser(db, phoneDigits);
    if (!record || (record.code || '').toUpperCase() !== cleanCode) {
      return json({ ok: false, reason: 'invalid' }, 401);
    }

    const purchases = await getReadyFichePurchases(db, phoneDigits);
    for (const pu of purchases) {
      if (pu.matiere === '*') pu.format = readyFormatOfTx(pu.txId ? await getTx(db, pu.txId) : null);   // forfait classe : PDF ou Word
    }
    const downloads = await getReadyFicheDownloads(db, phoneDigits);
    const versions = await getReadyVersions(db);
    const updates = downloads.filter(d => readyUpdateAvailable(versions, d.classe, d.matiere, d.downloadedAt)).map(d => ({ classe: d.classe, matiere: d.matiere }));
    return json({ ok: true, purchases, downloads, updates });
  } catch (err) {
    return json({ error: 'Erreur : ' + err.message }, 500);
  }
}

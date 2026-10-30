import { requireAdmin, json, listTx, getTx, getSetting, setSetting, hashGuestToken, guestDownloadKey, getReadyFicheDownloads, readyFormatOfTx } from './_shared.js';

/* Cloudflare Function — /api/admin-readyfiche-recovery  (29/10/2026)
   Outils admin pour les achats « Fiche Prête » SANS compte (identifiés par un jeton resté sur le téléphone de l'acheteur) :
     - action 'list'  : achats récents payés (n° de transaction, classe, matière, format, matières déjà téléchargées) ; q = filtre sur le n° ;
     - action 'code'  : génère un CODE DE RÉCUPÉRATION à usage unique (valable 7 jours) à envoyer à l'acheteur, qui le saisit dans
                        « J'ai perdu mon achat » pour rattacher son achat à son nouveau téléphone ;
     - action 'reset' : redonne UN téléchargement (efface la matière des téléchargements déjà faits) — ex. fichier perdu après téléchargement.
   Aucune migration : le code est rangé dans la table « settings » (sous forme hachée). */
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';   // sans 0/O/1/I : lisible au téléphone
const CODE_TTL_MS = 7 * 24 * 3600 * 1000;

function newCode() {
  const a = new Uint8Array(8);
  crypto.getRandomValues(a);
  return Array.from(a).map(b => CODE_ALPHABET[b % CODE_ALPHABET.length]).join('');
}

export async function onRequestPost(context) {
  const { request, env } = context;
  const db = env.FPB_DB;
  try {
    const body = await request.json();
    if (!(await requireAdmin(env, body.token))) return json({ ok: false, reason: 'invalid' }, 401);
    const action = String(body.action || 'list');

    if (action === 'list') {
      const q = String(body.q || '').trim();
      const all = (await listTx(db)).filter(t => t.type === 'readyfiche' && t.tier === 'guest' && t.status === 'paid' && (!q || String(t.id).includes(q)));
      const out = [];
      for (const t of all.slice(0, 80)) {
        const done = await getReadyFicheDownloads(db, guestDownloadKey(t.id));
        out.push({
          txId: t.id, classe: t.classe, matiere: t.matiere, format: readyFormatOfTx(t), amount: t.amount,
          paidAt: t.paidAt || t.createdAt, done: done.filter(d => d.classe === t.classe).map(d => d.matiere)
        });
      }
      return json({ ok: true, items: out });
    }

    const txId = String(body.txId || '').trim();
    const tx = txId ? await getTx(db, txId) : null;
    if (!tx || tx.type !== 'readyfiche' || tx.tier !== 'guest' || tx.status !== 'paid') {
      return json({ ok: false, reason: 'notfound', error: "Achat introuvable (n° de transaction inconnu, non payé, ou acheté avec un compte)." }, 404);
    }

    if (action === 'code') {
      const code = newCode();
      await setSetting(db, 'readyfiche_recovery:' + tx.id, { hash: await hashGuestToken(code), expires: Date.now() + CODE_TTL_MS, tries: 0 });
      return json({ ok: true, code, txId: tx.id, classe: tx.classe, matiere: tx.matiere, format: readyFormatOfTx(tx), expiresInDays: 7 });
    }

    if (action === 'reset') {
      const matiere = String(body.matiere || '').trim();
      if (!matiere || !/^[A-Za-z0-9_-]+$/.test(matiere)) return json({ ok: false, reason: 'invalid-params' }, 400);
      if (tx.matiere !== '*' && tx.matiere !== matiere) return json({ ok: false, reason: 'invalid-params', error: "Cette matière ne fait pas partie de l'achat." }, 400);
      await db.prepare('DELETE FROM readyfiche_downloads WHERE phone = ? AND classe = ? AND matiere = ?')
        .bind(guestDownloadKey(tx.id), tx.classe, matiere).run();
      return json({ ok: true });
    }

    return json({ ok: false, reason: 'invalid-params' }, 400);
  } catch (err) {
    return json({ error: 'Erreur : ' + err.message }, 500);
  }
}

import {
  requireAdmin, json, normalizePhone, getUser,
  getReadyFichePurchases, getReadyFicheDownloads, hasReadyFichePurchase,
  getResumePurchases, readyFormatOfTx
} from './_shared.js';

/* Cloudflare Function — /api/admin-client-purchases   (novembre 2026)
   Onglet admin « Achats d'un client » : on tape un NUMÉRO, on voit tout ce qui lui est rattaché et on peut corriger.

   Body : { token, action, phone, … }
   - 'get'             : tout ce que le numéro possède (voir plus bas) + numéros proches (mêmes 8 derniers chiffres).
   - 'delete-purchase' : { kind:'readyfiche'|'resume'|'resource', classe, matiere }  ou  { kind:'resource', resourceId }
                         retire l'achat ; pour une Fiche Prête, retire aussi les téléchargements qu'il couvrait
                         (sinon un nouvel achat serait bloqué par « déjà téléchargé »).
   - 'move-purchase'   : { newPhone, kind, classe, matiere | resourceId }  → erreur de numéro : l'achat passe au bon numéro,
                         le nouveau titulaire a un téléchargement tout neuf, l'ancien numéro perd l'achat.
   - 'allow-download'  : { kind:'readyfiche', classe, matiere }  → autorise un nouveau téléchargement de cette matière
                         (matiere '*' = toutes les matières de la classe) ;
                         { kind:'resume-free' | 'resource-free' } → remet à zéro les téléchargements GRATUITS déjà utilisés.
   Les paiements (table transactions) ne sont jamais supprimés : ce sont les écritures comptables.
   Aucun compte n'est nécessaire : les achats sont rangés par numéro, comme dans admin-grant-readyfiche. */

const SAFE = /^[A-Za-z0-9_-]{1,60}$/;
const SAFE_REF = /^[^\u0000-\u001f]{1,200}$/;
const RESUME_USAGE_KINDS = ['resume-one', 'resume-one-count', 'matiere', 'resume-class-free'];

async function all(db, sql, binds) {
  try {
    const { results } = await db.prepare(sql).bind(...(binds || [])).all();
    return results || [];
  } catch (e) {
    if (/no such table/i.test(String(e && e.message))) return [];
    throw e;
  }
}
async function run(db, sql, binds) {
  try {
    const r = await db.prepare(sql).bind(...(binds || [])).run();
    return (r && r.meta && r.meta.changes) || 0;
  } catch (e) {
    if (/no such table/i.test(String(e && e.message))) return 0;
    throw e;
  }
}

/* D'où vient l'achat ? (pour que l'admin comprenne tout de suite) */
function originOf(txId, tx) {
  if (!txId) return { origin: 'admin', label: 'Ajouté par l\'admin' };
  if (txId === 'free') return { origin: 'free', label: 'Gratuit' };
  if (txId === 'tier') return { origin: 'tier', label: 'Inclus dans le niveau du compte' };
  if (txId === 'ambassadeur-free') return { origin: 'ambassadeur', label: 'Offert (ambassadeur)' };
  if (tx) return { origin: 'paiement', label: 'Payé' + (tx.amount ? ' — ' + tx.amount + ' F' : '') + (tx.source ? ' (' + tx.source + ')' : '') };
  return { origin: 'paiement', label: 'Paiement ' + txId };
}

async function loadTxMap(db, ids) {
  const map = {};
  for (const id of ids) {
    if (!id || map[id] !== undefined) continue;
    const rows = await all(db, 'SELECT * FROM transactions WHERE id = ?', [String(id)]);
    map[id] = rows[0] || null;
  }
  return map;
}

async function getAll(db, phone) {
  const user = await getUser(db, phone);

  const rfP = await getReadyFichePurchases(db, phone);
  const rfD = await getReadyFicheDownloads(db, phone);
  const reP = await getResumePurchases(db, phone);
  const resRows = await all(db, 'SELECT resource_id, purchased_at, tx_id FROM resource_purchases WHERE phone = ? ORDER BY purchased_at DESC', [phone]);
  const txRows = await all(db, 'SELECT * FROM transactions WHERE phone = ? ORDER BY COALESCE(paid_at, created_at) DESC LIMIT 200', [phone]);
  const adminRows = await all(db, 'SELECT * FROM admin_downloads WHERE phone = ? ORDER BY created_at DESC LIMIT 100', [phone]);

  const txMap = await loadTxMap(db, [...rfP.map(p => p.txId), ...reP.map(p => p.txId), ...resRows.map(r => r.tx_id)]);

  const readyfiches = rfP.map(p => {
    const tx = p.txId ? txMap[p.txId] : null;
    const o = originOf(p.txId, tx);
    return {
      classe: p.classe, matiere: p.matiere, tier: p.tier, purchasedAt: p.purchasedAt, txId: p.txId || null,
      origin: o.origin, originLabel: o.label,
      format: p.matiere === '*' ? readyFormatOfTx(tx ? { source: tx.source } : null) : null
    };
  }).sort((a, b) => (b.purchasedAt || 0) - (a.purchasedAt || 0));

  const resumes = reP.map(p => {
    const o = originOf(p.txId, p.txId ? txMap[p.txId] : null);
    return { classe: p.classe, matiere: p.matiere, purchasedAt: p.purchasedAt, txId: p.txId || null, origin: o.origin, originLabel: o.label };
  }).sort((a, b) => (b.purchasedAt || 0) - (a.purchasedAt || 0));

  const resources = resRows.map(r => {
    const o = originOf(r.tx_id, r.tx_id ? txMap[r.tx_id] : null);
    return { resourceId: r.resource_id, purchasedAt: r.purchased_at, txId: r.tx_id || null, origin: o.origin, originLabel: o.label };
  });

  const usageResume = await all(db,
    `SELECT COUNT(*) AS c FROM download_usage WHERE owner = ? AND kind IN (${RESUME_USAGE_KINDS.map(() => '?').join(',')})`,
    [phone, ...RESUME_USAGE_KINDS]);
  const firstResume = await all(db, "SELECT COUNT(*) AS c FROM first_downloads WHERE phone = ? AND kind = 'matiere'", [phone]);
  const dlResume = await all(db, 'SELECT COUNT(*) AS c FROM resume_downloads WHERE phone = ?', [phone]);
  const usageRes = await all(db, "SELECT COUNT(*) AS c FROM download_usage WHERE owner = ? AND kind = 'rgroup'", [phone]);
  const firstRes = await all(db, "SELECT COUNT(*) AS c FROM first_downloads WHERE phone = ? AND kind = 'resource'", [phone]);
  const freeRes = await all(db, "SELECT COUNT(*) AS c FROM resource_purchases WHERE phone = ? AND tx_id = 'free'", [phone]);
  const n = (rows) => (rows[0] && rows[0].c) || 0;

  return {
    user: user ? {
      phone: user.phone, nom: user.nom, prenom: user.prenom, planLabel: user.planLabel,
      classe: user.classe || '', expiryTs: user.expiryTs, active: !!user.active
    } : null,
    readyfiches,
    readyfichesDownloads: rfD.sort((a, b) => (b.downloadedAt || 0) - (a.downloadedAt || 0)),
    resumes,
    resources,
    freeResumeUsed: n(usageResume) + n(firstResume) + n(dlResume),
    freeResourceUsed: n(usageRes) + n(firstRes) + n(freeRes),
    transactions: txRows.map(t => ({
      id: t.id, type: t.type, source: t.source, status: t.status, amount: t.amount,
      classe: t.classe, matiere: t.matiere, tier: t.tier, paidAt: t.paid_at, createdAt: t.created_at
    })),
    adminDownloads: adminRows
  };
}

/* Numéros qui ressemblent à celui tapé (mêmes 8 derniers chiffres) : aide à retrouver une faute de frappe / un indicatif. */
async function similarPhones(db, phone) {
  if (phone.length < 8) return [];
  const tail = phone.slice(-8);
  const found = new Set();
  for (const sql of [
    'SELECT DISTINCT phone AS p FROM users WHERE phone LIKE ? AND phone <> ?',
    'SELECT DISTINCT phone AS p FROM readyfiche_purchases WHERE phone LIKE ? AND phone <> ?',
    'SELECT DISTINCT phone AS p FROM resume_purchases WHERE phone LIKE ? AND phone <> ?',
    'SELECT DISTINCT phone AS p FROM resource_purchases WHERE phone LIKE ? AND phone <> ?',
    'SELECT DISTINCT phone AS p FROM transactions WHERE phone LIKE ? AND phone <> ?'
  ]) {
    for (const r of await all(db, sql, ['%' + tail, phone])) if (r.p) found.add(String(r.p));
  }
  return [...found].slice(0, 10);
}

function readCoords(body, kind) {
  if (kind === 'resource') {
    const resourceId = String(body.resourceId || '').trim();
    if (!SAFE_REF.test(resourceId)) return null;
    return { resourceId };
  }
  const classe = String(body.classe || '').trim();
  const matiere = String(body.matiere || '').trim();
  const classeOk = SAFE.test(classe) || (kind === 'resume' && classe === '*');
  const matiereOk = SAFE.test(matiere) || matiere === '*';
  if (!classeOk || !matiereOk) return null;
  if (classe === '*' && matiere !== '*') return null;
  return { classe, matiere };
}

/* Retire les téléchargements de Fiche Prête couverts par un achat supprimé et qu'aucun autre achat ne couvre encore. */
async function dropUncoveredReadyDownloads(db, phone, removed) {
  const remaining = await getReadyFichePurchases(db, phone);
  const downloads = await getReadyFicheDownloads(db, phone);
  let n = 0;
  for (const d of downloads) {
    const covered = d.classe === removed.classe && (removed.matiere === '*' || removed.matiere === d.matiere);
    if (!covered || hasReadyFichePurchase(remaining, d.classe, d.matiere)) continue;
    n += await run(db, 'DELETE FROM readyfiche_downloads WHERE phone = ? AND classe = ? AND matiere = ?', [phone, d.classe, d.matiere]);
  }
  return n;
}

export async function onRequestPost(context) {
  const { request, env } = context;
  const db = env.FPB_DB;
  try {
    const body = await request.json().catch(() => ({}));
    if (!(await requireAdmin(env, body.token))) return json({ ok: false, reason: 'invalid' }, 401);

    const phone = normalizePhone(body.phone);
    if (phone.length < 8) return json({ ok: false, error: 'Numéro de téléphone invalide.' }, 400);
    const action = String(body.action || 'get');

    if (action === 'get') {
      const data = await getAll(db, phone);
      data.similar = await similarPhones(db, phone);
      return json({ ok: true, phone, ...data });
    }

    if (action === 'allow-download') {
      const kind = String(body.kind || '');
      if (kind === 'readyfiche') {
        const c = readCoords(body, 'readyfiche');
        if (!c) return json({ ok: false, error: 'Classe ou matière invalide.' }, 400);
        const removed = c.matiere === '*'
          ? await run(db, 'DELETE FROM readyfiche_downloads WHERE phone = ? AND classe = ?', [phone, c.classe])
          : await run(db, 'DELETE FROM readyfiche_downloads WHERE phone = ? AND classe = ? AND matiere = ?', [phone, c.classe, c.matiere]);
        return json({ ok: true, removed });
      }
      if (kind === 'resume-free') {
        let removed = await run(db,
          `DELETE FROM download_usage WHERE owner = ? AND kind IN (${RESUME_USAGE_KINDS.map(() => '?').join(',')})`,
          [phone, ...RESUME_USAGE_KINDS]);
        removed += await run(db, "DELETE FROM first_downloads WHERE phone = ? AND kind = 'matiere'", [phone]);
        removed += await run(db, 'DELETE FROM resume_downloads WHERE phone = ?', [phone]);
        return json({ ok: true, removed });
      }
      if (kind === 'resource-free') {
        let removed = await run(db, "DELETE FROM download_usage WHERE owner = ? AND kind = 'rgroup'", [phone]);
        removed += await run(db, "DELETE FROM first_downloads WHERE phone = ? AND kind = 'resource'", [phone]);
        removed += await run(db, "DELETE FROM resource_purchases WHERE phone = ? AND tx_id = 'free'", [phone]);
        return json({ ok: true, removed });
      }
      return json({ ok: false, error: 'Type invalide.' }, 400);
    }

    if (action === 'delete-purchase' || action === 'move-purchase') {
      const kind = String(body.kind || '');
      if (!['readyfiche', 'resume', 'resource'].includes(kind)) return json({ ok: false, error: 'Type invalide.' }, 400);
      const c = readCoords(body, kind);
      if (!c) return json({ ok: false, error: kind === 'resource' ? 'Ressource invalide.' : 'Classe ou matière invalide.' }, 400);

      let newPhone = '';
      if (action === 'move-purchase') {
        newPhone = normalizePhone(body.newPhone);
        if (newPhone.length < 8) return json({ ok: false, error: 'Le nouveau numéro est invalide.' }, 400);
        if (newPhone === phone) return json({ ok: false, error: 'Le nouveau numéro est le même que l\'ancien.' }, 400);
      }

      // L'achat existe-t-il ?
      let row;
      if (kind === 'readyfiche') row = (await all(db, 'SELECT * FROM readyfiche_purchases WHERE phone = ? AND classe = ? AND matiere = ?', [phone, c.classe, c.matiere]))[0];
      else if (kind === 'resume') row = (await all(db, 'SELECT * FROM resume_purchases WHERE phone = ? AND classe = ? AND matiere = ?', [phone, c.classe, c.matiere]))[0];
      else row = (await all(db, 'SELECT * FROM resource_purchases WHERE phone = ? AND resource_id = ?', [phone, c.resourceId]))[0];
      if (!row) return json({ ok: false, error: 'Cet achat n\'existe plus pour ce numéro.' }, 404);

      if (action === 'move-purchase') {
        if (kind === 'readyfiche') {
          await run(db, 'INSERT OR IGNORE INTO readyfiche_purchases (phone, classe, matiere, tier, purchased_at, tx_id) VALUES (?,?,?,?,?,?)',
            [newPhone, row.classe, row.matiere, row.tier, row.purchased_at, row.tx_id]);
        } else if (kind === 'resume') {
          await run(db, 'INSERT OR IGNORE INTO resume_purchases (phone, classe, matiere, purchased_at, tx_id) VALUES (?,?,?,?,?)',
            [newPhone, row.classe, row.matiere, row.purchased_at, row.tx_id]);
        } else {
          await run(db, 'INSERT OR IGNORE INTO resource_purchases (phone, resource_id, purchased_at, tx_id) VALUES (?,?,?,?)',
            [newPhone, row.resource_id, row.purchased_at, row.tx_id]);
        }
        // Le paiement qui a servi à cet achat suit le bon numéro (sinon il resterait affiché chez l'ancien).
        if (row.tx_id && !['free', 'tier', 'ambassadeur-free'].includes(row.tx_id)) {
          await run(db, 'UPDATE transactions SET phone = ? WHERE id = ? AND phone = ?', [newPhone, String(row.tx_id), phone]);
        }
      }

      // Retrait de l'achat chez le numéro d'origine.
      if (kind === 'readyfiche') await run(db, 'DELETE FROM readyfiche_purchases WHERE phone = ? AND classe = ? AND matiere = ?', [phone, c.classe, c.matiere]);
      else if (kind === 'resume') await run(db, 'DELETE FROM resume_purchases WHERE phone = ? AND classe = ? AND matiere = ?', [phone, c.classe, c.matiere]);
      else await run(db, 'DELETE FROM resource_purchases WHERE phone = ? AND resource_id = ?', [phone, c.resourceId]);

      // Fiches Prêtes : les téléchargements faits par l'ancien numéro ne comptent pas pour le nouveau titulaire.
      let downloadsRemoved = 0;
      if (kind === 'readyfiche') downloadsRemoved = await dropUncoveredReadyDownloads(db, phone, { classe: row.classe, matiere: row.matiere });

      // Historique « Télécharger pour un client » : il suit l'achat (ou disparaît avec lui).
      if (kind !== 'resource' && !row.tx_id) {
        const adminKind = kind === 'resume' ? 'resume' : 'readyfiche';
        if (action === 'move-purchase') {
          await run(db, 'UPDATE admin_downloads SET phone = ? WHERE phone = ? AND kind = ? AND classe = ? AND matiere = ?',
            [newPhone, phone, adminKind, row.classe, row.matiere]);
        } else {
          await run(db, 'DELETE FROM admin_downloads WHERE phone = ? AND kind = ? AND classe = ? AND matiere = ?',
            [phone, adminKind, row.classe, row.matiere]);
        }
      }

      return json({ ok: true, downloadsRemoved, newPhone: newPhone || undefined });
    }

    return json({ ok: false, error: 'Action inconnue.' }, 400);
  } catch (err) {
    return json({ ok: false, error: 'Erreur : ' + err.message }, 500);
  }
}

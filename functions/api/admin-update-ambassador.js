import {
  requireAdmin, json, ensureAmbassadorsTable, AMBASSADOR_STATES, normalizePhone,
  getUser, upsertUser, generateUniqueCode, isAmbassadorUser,
  AMBASSADOR_PLAN_INDEX, AMBASSADOR_PLAN_LABEL, AMBASSADOR_VALIDITY_MS, AMBASSADOR_UNLIMITED_QUOTA
} from './_shared.js';

/* Cloudflare Function — /api/admin-update-ambassador (admin)
   Body : { token, id, action, status? }
   - action 'status'  : change le statut. 'accepte' crée/active le compte ambassadeur (comme 'accept') ;
                        tout autre statut désactive le compte ambassadeur déjà créé.
   - action 'accept'  : accepte la demande -> crée le compte ambassadeur (code + 1 an), idempotent.
   - action 'renew'   : renouvelle l'accès pour 1 an (à partir de l'échéance si elle n'est pas dépassée).
   - action 'delete'  : supprime la demande (et désactive le compte ambassadeur associé). */

/* Crée / réactive / renouvelle le compte ambassadeur lié à une demande. */
async function grantAmbassadorAccount(db, row, { renew }) {
  const now = Date.now();
  const phone = normalizePhone(row.phone);
  const existing = await getUser(db, phone);
  const existingAmb = isAmbassadorUser(existing) ? existing : null;

  // Accepter une demande déjà acceptée, valide et active ne change rien (pas de prolongation involontaire).
  if (!renew && existingAmb && existingAmb.active && existingAmb.expiryTs > now && existingAmb.code) {
    return { code: existingAmb.code, expiryTs: existingAmb.expiryTs, renewed: false, created: false };
  }

  const code = existingAmb && existingAmb.code ? existingAmb.code : await generateUniqueCode(db, 8);
  if (!code) throw new Error('Impossible de générer un code unique, réessaie.');

  const base = (renew && existingAmb && existingAmb.expiryTs > now) ? existingAmb.expiryTs : now;
  const expiryTs = base + AMBASSADOR_VALIDITY_MS;

  const record = {
    phone,
    nom: row.nom,
    prenom: row.prenoms,
    code,
    planIndex: AMBASSADOR_PLAN_INDEX,
    planLabel: AMBASSADOR_PLAN_LABEL,
    classe: null,
    expiryTs,
    quotaTotal: AMBASSADOR_UNLIMITED_QUOTA,
    quotaUsed: 0,
    active: true,
    promo: existing ? existing.promo : null,
    createdAt: existing ? existing.createdAt : now,
    updatedAt: now,
    history: [
      ...((existing && existing.history) || []),
      { code, planLabel: AMBASSADOR_PLAN_LABEL, expiryTs, generatedAt: now, renewed: !!renew, ambassador: row.numero || null }
    ]
  };
  await upsertUser(db, record);
  await db.prepare('UPDATE ambassadors SET status = ?, code = ?, expiry_ts = ?, accepted_at = ? WHERE id = ?')
    .bind('accepte', code, expiryTs, row.accepted_at || now, row.id).run();
  return { code, expiryTs, renewed: !!renew, created: !existingAmb };
}

/* Coupe l'accès du compte ambassadeur (sans le supprimer : on peut le réactiver en re-acceptant). */
async function suspendAmbassadorAccount(db, row) {
  const user = await getUser(db, normalizePhone(row.phone));
  if (isAmbassadorUser(user) && user.active) {
    user.active = false;
    user.updatedAt = Date.now();
    await upsertUser(db, user);
  }
}

export async function onRequestPost(context) {
  const { request, env } = context;
  const db = env.FPB_DB;
  try {
    const { token, id, action, status } = await request.json();
    if (!(await requireAdmin(env, token))) return json({ error: 'Non autorisé' }, 401);
    const rowId = parseInt(id, 10);
    if (!rowId) return json({ error: 'Identifiant invalide.' }, 400);
    await ensureAmbassadorsTable(db);

    const row = await db.prepare('SELECT * FROM ambassadors WHERE id = ?').bind(rowId).first();
    if (!row) return json({ error: 'Demande introuvable.' }, 404);

    if (action === 'delete') {
      await suspendAmbassadorAccount(db, row);
      await db.prepare('DELETE FROM ambassadors WHERE id = ?').bind(rowId).run();
      return json({ ok: true });
    }

    if (action === 'accept' || (action === 'status' && status === 'accepte')) {
      const r = await grantAmbassadorAccount(db, row, { renew: false });
      return json({ ok: true, status: 'accepte', ...r });
    }

    if (action === 'renew') {
      const r = await grantAmbassadorAccount(db, row, { renew: true });
      return json({ ok: true, status: 'accepte', ...r });
    }

    if (action === 'status') {
      if (!AMBASSADOR_STATES.includes(status)) return json({ error: 'Statut invalide.' }, 400);
      await db.prepare('UPDATE ambassadors SET status = ? WHERE id = ?').bind(status, rowId).run();
      await suspendAmbassadorAccount(db, row);
      return json({ ok: true, status });
    }
    return json({ error: 'Action inconnue.' }, 400);
  } catch (err) {
    return json({ error: "Erreur lors de la mise à jour de l'ambassadeur : " + err.message }, 500);
  }
}

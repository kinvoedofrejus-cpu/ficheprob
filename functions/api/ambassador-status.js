import { json, normalizePhone, ensureAmbassadorsTable } from './_shared.js';

/* Cloudflare Function — /api/ambassador-status (public)
   Suivi d'une demande « Devenir Ambassadeur ». Body : { numero?, phone? } (au moins un des deux).
   Renvoie uniquement le statut de la demande — JAMAIS le code d'accès : celui-ci est envoyé
   par l'équipe sur le WhatsApp indiqué dans la demande. */
const last8 = p => normalizePhone(p).slice(-8);

export async function onRequestPost(context) {
  const { request, env } = context;
  const db = env.FPB_DB;
  try {
    const b = await request.json();
    const numero = String(b.numero || '').trim().toUpperCase().replace(/\s+/g, '');
    const phone = normalizePhone(b.phone);
    if (!numero && phone.length < 8) {
      return json({ ok: false, error: 'Indique ton numéro de traitement (AMB-AAAA-NNNN) ou ton numéro WhatsApp.' }, 400);
    }
    await ensureAmbassadorsTable(db);

    let row = null;
    if (numero) {
      row = await db.prepare('SELECT * FROM ambassadors WHERE UPPER(numero) = ? ORDER BY id DESC LIMIT 1').bind(numero).first();
      if (row && phone.length >= 8 && last8(row.phone) !== last8(phone)) row = null;
    } else {
      const { results } = await db.prepare('SELECT * FROM ambassadors ORDER BY id DESC LIMIT 1000').all();
      row = (results || []).find(r => last8(r.phone) === last8(phone)) || null;
    }
    if (!row) return json({ ok: false, error: 'Aucune demande trouvée avec ces informations.' }, 404);

    return json({
      ok: true,
      ambassador: {
        numero: row.numero, prenoms: row.prenoms, lieu: row.lieu,
        status: row.status, createdAt: row.created_at,
        expiryTs: row.status === 'accepte' ? (row.expiry_ts || null) : null
      }
    });
  } catch (err) {
    return json({ error: 'Erreur lors de la recherche de la demande : ' + err.message }, 500);
  }
}

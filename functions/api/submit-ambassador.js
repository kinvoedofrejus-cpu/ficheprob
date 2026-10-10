import {
  json, normalizePhone, ensureAmbassadorsTable, ambassadorFromRow,
  AMBASSADOR_STATUTS, AMBASSADOR_FONCTIONS
} from './_shared.js';

/* Cloudflare Function — /api/submit-ambassador
   Enregistre une demande « Devenir Ambassadeur FicheProBot » et renvoie le
   numéro de traitement (AMB-AAAA-NNNN). Public (aucun compte requis).
   Body : { nom, prenoms, statut, fonction, residence, lieu, phone, email? } */
export async function onRequestPost(context) {
  const { request, env } = context;
  const db = env.FPB_DB;
  try {
    const b = await request.json();
    const clean = (v, max = 120) => String(v || '').replace(/\s+/g, ' ').trim().slice(0, max);
    const nom = clean(b.nom);
    const prenoms = clean(b.prenoms);
    const statut = clean(b.statut, 20);
    const fonction = clean(b.fonction, 60);
    const residence = clean(b.residence);
    const lieu = clean(b.lieu);
    const email = clean(b.email);
    const phone = normalizePhone(b.phone);

    if (!nom || !prenoms || !residence || !lieu) {
      return json({ error: 'Veuillez remplir tous les champs obligatoires.' }, 400);
    }
    if (!AMBASSADOR_STATUTS.includes(statut)) return json({ error: 'Statut invalide.' }, 400);
    if (!AMBASSADOR_FONCTIONS.includes(fonction)) return json({ error: 'Fonction invalide.' }, 400);
    if (phone.length < 8 || phone.length > 15) return json({ error: 'Numéro WhatsApp invalide.' }, 400);
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return json({ error: 'Adresse email invalide.' }, 400);

    await ensureAmbassadorsTable(db);

    // Protection contre le double envoi (double clic, réseau lent) : même numéro dans les 10 dernières minutes
    const recent = await db.prepare('SELECT * FROM ambassadors WHERE phone = ? AND created_at > ? ORDER BY id DESC LIMIT 1')
      .bind(phone, Date.now() - 10 * 60 * 1000).first();
    if (recent) {
      const pub = ambassadorFromRow(recent);
      delete pub.code; delete pub.expiryTs; delete pub.acceptedAt;
      return json({ ok: true, already: true, ambassador: pub });
    }

    const now = Date.now();
    const res = await db.prepare(
      `INSERT INTO ambassadors (numero, nom, prenoms, statut, fonction, residence, lieu, phone, email, status, created_at)
       VALUES ('', ?, ?, ?, ?, ?, ?, ?, ?, 'nouveau', ?)`
    ).bind(nom, prenoms, statut, fonction, residence, lieu, phone, email, now).run();
    const id = res.meta.last_row_id;
    const numero = 'AMB-' + new Date(now).getFullYear() + '-' + String(id).padStart(4, '0');
    await db.prepare('UPDATE ambassadors SET numero = ? WHERE id = ?').bind(numero, id).run();

    return json({
      ok: true,
      ambassador: { id, numero, nom, prenoms, statut, fonction, residence, lieu, phone, email, status: 'nouveau', createdAt: now }
    });
  } catch (err) {
    return json({ error: "Erreur lors de l'enregistrement de la demande : " + err.message }, 500);
  }
}

import { requireAdmin, json, normalizePhone, getUser, getReadyFichePurchases, addReadyFichePurchase } from './_shared.js';

/* Cloudflare Function — /api/admin-grant-readyfiche   (novembre 2026)
   Fiches Prêtes envoyées PAR WHATSAPP (paiement hors appli) : l'admin rattache l'achat au COMPTE de la personne, pour qu'elle
   le retrouve dans « Mes achats » (profil et accueil) et puisse télécharger plus tard, comme un achat fait dans l'appli.
   Body : { token, action:'grant'|'list', phone, classe, matiere }     (matiere '*' = toute la classe)
   - 'grant' : crée la ligne dans readyfiche_purchases (tier 'admin', sans transaction) ; sans effet si elle existe déjà ;
   - 'list'  : liste les achats déjà rattachés à ce compte.
   Compte pas encore créé : l'achat attend ce numéro et apparaît à la création du compte.
   Le téléchargement reste soumis à la règle habituelle (une seule fois par matière). */
export async function onRequestPost(context) {
  const { request, env } = context;
  const db = env.FPB_DB;
  try {
    const body = await request.json();
    if (!(await requireAdmin(env, body.token))) return json({ ok: false, reason: 'invalid' }, 401);
    const phone = normalizePhone(body.phone);
    if (phone.length < 8) return json({ ok: false, error: 'Numéro de téléphone invalide.' }, 400);
    /* Le compte n'a PAS besoin d'exister : les achats sont rangés par numéro de téléphone. Dès que la personne crée son compte
       avec ce numéro (gratuit ou payant), ses fiches apparaissent toutes seules dans « Mes achats ». */
    const user = await getUser(db, phone);
    const name = user ? ((user.prenom || '') + ' ' + (user.nom || '')).trim() : '';
    const hasAccount = !!user;
    const action = String(body.action || 'grant');
    if (action === 'list') return json({ ok: true, purchases: await getReadyFichePurchases(db, phone), name, hasAccount });
    const classe = String(body.classe || '').trim();
    /* Une ou plusieurs matières : « matieres » (liste) ; « matiere » (une seule) reste accepté. */
    let matieres = Array.isArray(body.matieres) ? body.matieres : [body.matiere];
    matieres = [...new Set(matieres.map(m => String(m || '').trim()).filter(Boolean))].slice(0, 60);
    if (!matieres.length) return json({ ok: false, error: 'Choisis au moins une matière.' }, 400);
    if (!/^[A-Za-z0-9_-]{1,40}$/.test(classe) || matieres.some(m => !(m === '*' || /^[A-Za-z0-9_-]{1,60}$/.test(m)))) return json({ ok: false, error: 'Classe ou matière invalide.' }, 400);
    let purchases = [];
    for (const matiere of matieres) {
      purchases = await addReadyFichePurchase(db, phone, classe, matiere, matiere === '*' ? 'classe' : 'matiere', null);
    }
    return json({ ok: true, purchases, added: matieres.length, name, hasAccount });
  } catch (err) {
    return json({ ok: false, error: 'Erreur : ' + err.message }, 500);
  }
}

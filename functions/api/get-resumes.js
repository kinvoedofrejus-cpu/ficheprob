import { normalizePhone, json, getUser, listResumes, getResumePurchases, getHiddenMatieres, getHiddenClasses } from './_shared.js';

/* Compte administrateur codé en dur (voir user-login.js / record-usage.js) : ce compte
   n'a AUCUNE ligne dans la table "users" de la base D1, donc on ne doit surtout pas
   passer par getUser() pour lui — sinon il est systématiquement rejeté ('invalid'). */
const OWNER_PHONE_HARDCODED = '0166661846';
const OWNER_CODE_HARDCODED = 'KINVOS';

export async function onRequestPost(context) {
  const { request, env } = context;
  const db = env.FPB_DB;
  try {
    const { phone, code } = await request.json();
    const phoneDigits = normalizePhone(phone);
    const cleanCode = (code || '').trim().toUpperCase();
    if (phoneDigits.length < 8 || !cleanCode) {
      return json({ ok: false, reason: 'invalid' }, 400);
    }

    const isOwner = phoneDigits === normalizePhone(OWNER_PHONE_HARDCODED) && cleanCode === OWNER_CODE_HARDCODED;

    if (!isOwner) {
      const record = await getUser(db, phoneDigits);
      if (!record || (record.code || '').toUpperCase() !== cleanCode) {
        return json({ ok: false, reason: 'invalid' }, 401);
      }
      if (!record.active) return json({ ok: false, reason: 'inactive' }, 403);
      if (record.expiryTs <= Date.now()) return json({ ok: false, reason: 'expired' }, 403);
    }

    // Les résumés sont classés par classe précise (CI, CP, CE1, CE2, CM1, CM2) : l'utilisateur
    // parcourt lui-même la classe puis la matière dans l'app, donc on ne filtre plus ici par la
    // classe (groupée) de son compte — on renvoie tous les résumés disponibles.
    const list = await listResumes(db);
    const filtered = list.map(r => ({ id: r.id, matiere: r.matiere, classe: r.classe, unite: r.unite || '', sa: r.sa || '', sequence: r.sequence || '', dossier: r.dossier || '', titre: r.titre, texte: r.texte, images: r.images || [], updatedAt: r.updatedAt }));

    // Matières (classe+matiere) déjà achetées en intégralité par ce compte : donne un
    // téléchargement illimité, sans compter sur le quota gratuit hebdomadaire.
    // Le compte admin illimité n'a pas d'achats à chercher (déjà tout illimité côté appli).
    const purchases = isOwner ? [] : await getResumePurchases(db, phoneDigits);

    // Matières "officielles" masquées par l'admin (parce qu'elles n'ont pas besoin de résumé) :
    // l'appli les retire de la liste de matières proposée à l'enseignant.
    const hiddenMatieres = await getHiddenMatieres(db);

    // Classes entières masquées par l'admin (ex : pas encore de contenu prêt pour cette classe) :
    // l'appli les retire de la liste de classes proposée à l'enseignant.
    const hiddenClasses = await getHiddenClasses(db);

    return json({ ok: true, resumes: filtered, purchases, hiddenMatieres, hiddenClasses });
  } catch (err) {
    return json({ error: 'Erreur lors du chargement des résumés : ' + err.message }, 500);
  }
}

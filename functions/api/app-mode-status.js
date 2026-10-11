import { json, getAppMode } from './_shared.js';

/* Endpoint public (pas d'auth) — renvoie le mode actuel de l'application :
   'payant' (fonctionnement normal : essai gratuit 10 fiches puis abonnement)
   ou 'gratuit' (tout le monde fait des fiches gratuitement, piloté depuis
   l'onglet "Abonnements" du dashboard admin). Appelé par index.html au
   chargement pour adapter canCreateFiche(). */
export async function onRequestGet(context) {
  const { env } = context;
  try {
    const { mode, until } = await getAppMode(env.FPB_DB);
    return json({ ok: true, mode, until });
  } catch (err) {
    return json({ error: 'Erreur : ' + err.message }, 500);
  }
}

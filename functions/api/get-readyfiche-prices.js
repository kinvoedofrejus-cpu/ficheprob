import { json, getReadyFichePrices, getReadyVersions } from './_shared.js';

/* Endpoint public — prix courants des Fiches Prêtes (réglés par l'admin via
   admin-set-readyfiche-prices.js). 0 = gratuit. Lu par index.html. */
export async function onRequestGet(context) {
  try {
    const prices = await getReadyFichePrices(context.env.FPB_DB);
    return json({ ok: true, ...prices, versions: await getReadyVersions(context.env.FPB_DB) });
  } catch (err) {
    return json({ error: 'Erreur : ' + err.message }, 500);
  }
}

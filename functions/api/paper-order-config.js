import { json } from './_shared.js';
import { getPaperConfig, PAPER_MIN_PARTIAL } from './_paper.js';

/* Endpoint public — prix d'une fiche papier (réglé par l'admin). null = pas encore défini. */
export async function onRequestGet(context) {
  try {
    const cfg = await getPaperConfig(context.env.FPB_DB);
    return json({ ok: true, ...cfg, minPartial: PAPER_MIN_PARTIAL });
  } catch (err) {
    return json({ error: 'Erreur : ' + err.message }, 500);
  }
}

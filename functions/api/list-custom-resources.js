import { json } from './_shared.js';
import { listCustomResources } from './_customres.js';

/* Public — GET /api/list-custom-resources : liste des documents de la carte « Autres » (id + titre). */
export async function onRequestGet(context) {
  try {
    const list = await listCustomResources(context.env.FPB_DB);
    return json({ ok: true, resources: list }, 200);
  } catch (err) {
    return json({ ok: false, resources: [], error: err.message }, 200);
  }
}

import { json, kvKeyTx, kvGetJSON } from './_shared.js';

export async function onRequestGet(context) {
  const { request, env } = context;
  const kv = env.FPB_KV;
  const url = new URL(request.url);
  const id = url.searchParams.get('id');

  if (!id) return json({ error: 'Paramètre id manquant' }, 400);

  try {
    const record = await kvGetJSON(kv, kvKeyTx(id));
    if (!record) return json({ status: 'unknown' }, 404);

    return json({
      status: record.status,
      code: record.code || null,
      phone: record.phone,
      planIndex: record.planIndex
    });
  } catch (err) {
    return json({ error: 'Erreur lors de la vérification du paiement : ' + err.message }, 500);
  }
}

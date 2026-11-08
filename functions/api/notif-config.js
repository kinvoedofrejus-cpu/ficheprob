import { json } from './_shared.js';
import { channelsStatus } from './_notify.js';

/* GET /api/notif-config — clé publique VAPID (publique par nature) + canaux disponibles, pour que l'app sache quoi proposer. */
export async function onRequestGet(context) {
  const { env } = context;
  const ch = channelsStatus(env);
  return json({ ok: true, vapidPublicKey: ch.push ? env.VAPID_PUBLIC_KEY : '', channels: { push: ch.push, email: ch.email, whatsapp: ch.whatsapp } });
}

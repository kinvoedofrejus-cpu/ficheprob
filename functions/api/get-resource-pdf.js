import { json, ensureDownloadTables, resolveOwner, getDownloadPolicies, hasPaidResourcePurchase, resourceGroupOf, normalizePhone } from './_shared.js';
import { OWNER_PHONE_HARDCODED, OWNER_CODE_HARDCODED } from './user-login.js';

// Cloudflare Function — /api/get-resource-pdf
//
// Sert le PDF de BASE (sans nom d'enseignant) d'une ressource didactique
// ("Calcul mental", "Structure", etc. — voir resources-catalog.js), stocké
// dans R2 sous resource-pdfs/{id}.pdf.
// - Politique admin des ressources 'normal' (défaut) ou 'gratuit' : pas de vérification d'achat ici
//   (le droit au téléchargement est vérifié avant par /api/claim-first-download ; en 'gratuit' tout est libre).
// - Politique 'payant' : le serveur exige un achat réel de cette ressource (ou de tous les niveaux de son type)
//   pour le compte (phone+code) ou l'appareil (deviceId) passés en paramètres ; sinon 402. Le compte administrateur
//   et les comptes ambassadeurs sont exemptés.
export async function onRequestGet(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const id = (url.searchParams.get('id') || '').trim();
  if (!id) return new Response('Identifiant manquant', { status: 400 });

  const db = env.FPB_DB;
  // Les documents de la carte « Autres » (id « autres-… ») sont toujours en téléchargement libre.
  if (db && !id.startsWith('autres-') && (await getDownloadPolicies(db)).resources === 'payant') {
    const phone = url.searchParams.get('phone') || '';
    const code = (url.searchParams.get('code') || '').trim();
    const isOwner = normalizePhone(phone) === normalizePhone(OWNER_PHONE_HARDCODED) && code === OWNER_CODE_HARDCODED;
    if (!isOwner) {
      await ensureDownloadTables(db);
      const who = await resolveOwner(db, { phone, code, deviceId: url.searchParams.get('deviceId') || '' });
      const group = resourceGroupOf(id);
      const ok = !!who.owner && !!group && (who.ambassador || (
        await hasPaidResourcePurchase(db, who.owner, id) || await hasPaidResourcePurchase(db, who.owner, 'all:' + group)
      ));
      if (!ok) return json({ ok: false, reason: 'payment_required', paidOnly: true }, 402);
    }
  }

  const key = `resource-pdfs/${id}.pdf`;
  const obj = await env.FPB_IMAGES.get(key);
  if (!obj) return new Response('Ressource introuvable', { status: 404 });

  return new Response(obj.body, {
    headers: {
      'Content-Type': 'application/pdf',
      'Cache-Control': 'private, no-store'
    }
  });
}

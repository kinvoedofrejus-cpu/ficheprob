// Cloudflare Function — /api/get-resource-pdf
//
// Sert le PDF de BASE (sans nom d'enseignant) d'une ressource didactique
// ("Calcul mental", "Structure", etc. — voir resources-catalog.js), stocké
// dans R2 sous resource-pdfs/{id}.pdf. Gratuit, pas de vérification
// d'achat : seul le nom de l'enseignant est ajouté côté client (voir
// stampResourcePdf dans index.html) à partir de resource-pdfs/{id}.meta.json.
export async function onRequestGet(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const id = (url.searchParams.get('id') || '').trim();
  if (!id) return new Response('Identifiant manquant', { status: 400 });

  const key = `resource-pdfs/${id}.pdf`;
  const obj = await env.FPB_IMAGES.get(key);
  if (!obj) return new Response('Ressource introuvable', { status: 404 });

  return new Response(obj.body, {
    headers: {
      'Content-Type': 'application/pdf',
      'Cache-Control': 'public, max-age=86400'
    }
  });
}

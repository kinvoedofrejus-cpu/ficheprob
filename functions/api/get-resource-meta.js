// Cloudflare Function — /api/get-resource-meta
//
// Sert le resource-pdfs/{id}.meta.json associé à une ressource didactique :
// { pageWidthPt, pageHeightPt, parSlots:[{page,x1,top,bottom}, ...] } —
// positions (en points PDF) de chaque occurrence de "Par :" dans le PDF, pour
// que stampResourcePdf (index.html) sache où écrire le nom de l'enseignant.
export async function onRequestGet(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const id = (url.searchParams.get('id') || '').trim();
  if (!id) return new Response('Identifiant manquant', { status: 400 });

  const key = `resource-pdfs/${id}.meta.json`;
  const obj = await env.FPB_IMAGES.get(key);
  if (!obj) return new Response('Métadonnées introuvables', { status: 404 });

  return new Response(obj.body, {
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'public, max-age=86400'
    }
  });
}

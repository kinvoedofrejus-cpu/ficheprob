/* Cloudflare Function — /api/get-readyfiche-docx-preview?classe=CM1&matiere=mathematique (public, 29/10/2026)
   Aperçu gratuit du Word : les 2 premières fiches de la matière, créées à partir du Word complet par la page admin au moment du dépôt
   (admin-upload-readyfiche-word.html) et rangées dans R2 sous readyfiche-docx-preview/{classe}/{matiere}.docx. */
export async function onRequestGet(context) {
  try {
    const u = new URL(context.request.url);
    const classe = u.searchParams.get('classe') || '', matiere = u.searchParams.get('matiere') || '';
    if (!/^[A-Za-z0-9_-]{1,40}$/.test(classe) || !/^[A-Za-z0-9_-]{1,60}$/.test(matiere)) return new Response('Requête invalide', { status: 400 });
    const obj = await context.env.FPB_IMAGES.get(`readyfiche-docx-preview/${classe}/${matiere}.docx`);
    if (!obj) return new Response('Aperçu Word introuvable', { status: 404 });
    return new Response(obj.body, { headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'Content-Disposition': `attachment; filename="apercu-${classe}-${matiere}.docx"`,
      'Cache-Control': 'public, max-age=300'
    } });
  } catch (err) {
    return new Response('Erreur : ' + err.message, { status: 500 });
  }
}

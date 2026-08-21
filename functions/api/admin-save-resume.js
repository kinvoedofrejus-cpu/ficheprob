import { requireAdmin, json, getResume, upsertResume, randomCode } from './_shared.js';

export async function onRequestPost(context) {
  const { request, env } = context;
  const db = env.FPB_DB;
  try {
    const { token, id, matiere, classe, unite, sa, sequence, dossier, titre, texte, images } = await request.json();
    if (!(await requireAdmin(env, token))) return json({ error: 'Non autorisé' }, 401);

    const cleanMatiere = (matiere || '').trim();
    const cleanClasse = (classe || '').trim();
    const cleanUnite = (unite || '').trim();
    const cleanSa = (sa || '').trim();
    const cleanSequence = (sequence || '').trim();
    const cleanDossier = (dossier || '').trim();
    const cleanTitre = (titre || '').trim();
    const cleanTexte = (texte || '').trim();
    // Photos illustrant le résumé (URLs "/api/get-image?key=...' pointant vers R2, préfixe "resumes/")
    const cleanImages = Array.isArray(images) ? images.filter(u => typeof u === 'string' && u.trim()).slice(0, 10) : undefined;

    if (!cleanMatiere || !cleanClasse || !cleanTitre || !cleanTexte) {
      return json({ error: 'Matière, classe, titre et texte sont obligatoires' }, 400);
    }

    const now = Date.now();

    if (id) {
      // Modification d'un résumé existant
      const existing = await getResume(db, id);
      if (!existing) return json({ error: 'Résumé introuvable' }, 404);
      const resume = {
        ...existing,
        matiere: cleanMatiere,
        classe: cleanClasse,
        unite: cleanUnite,
        sa: cleanSa,
        sequence: cleanSequence,
        dossier: cleanDossier,
        titre: cleanTitre,
        texte: cleanTexte,
        images: cleanImages !== undefined ? cleanImages : (existing.images || []),
        updatedAt: now
      };
      await upsertResume(db, resume);
      return json({ ok: true, resume });
    }

    // Nouveau résumé
    const resume = {
      id: randomCode(10),
      matiere: cleanMatiere,
      classe: cleanClasse,
      unite: cleanUnite,
      sa: cleanSa,
      sequence: cleanSequence,
      dossier: cleanDossier,
      titre: cleanTitre,
      texte: cleanTexte,
      images: cleanImages || [],
      createdAt: now,
      updatedAt: now
    };
    await upsertResume(db, resume);

    return json({ ok: true, resume });
  } catch (err) {
    return json({ error: "Erreur lors de l'enregistrement du résumé : " + err.message }, 500);
  }
}

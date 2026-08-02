import { requireAdmin, json, getResumeList, saveResumeList, randomCode } from './_shared.js';

export async function onRequestPost(context) {
  const { request, env } = context;
  const kv = env.FPB_KV;
  try {
    const { token, id, matiere, classe, titre, texte } = await request.json();
    if (!(await requireAdmin(env, token))) return json({ error: 'Non autorisé' }, 401);

    const cleanMatiere = (matiere || '').trim();
    const cleanClasse = (classe || '').trim();
    const cleanTitre = (titre || '').trim();
    const cleanTexte = (texte || '').trim();

    if (!cleanMatiere || !cleanClasse || !cleanTitre || !cleanTexte) {
      return json({ error: 'Matière, classe, titre et texte sont obligatoires' }, 400);
    }

    const now = Date.now();
    const list = await getResumeList(kv);

    if (id) {
      // Modification d'un résumé existant
      const idx = list.findIndex(r => r.id === id);
      if (idx === -1) return json({ error: 'Résumé introuvable' }, 404);
      list[idx] = {
        ...list[idx],
        matiere: cleanMatiere,
        classe: cleanClasse,
        titre: cleanTitre,
        texte: cleanTexte,
        updatedAt: now
      };
      await saveResumeList(kv, list);
      return json({ ok: true, resume: list[idx] });
    }

    // Nouveau résumé
    const resume = {
      id: randomCode(10),
      matiere: cleanMatiere,
      classe: cleanClasse,
      titre: cleanTitre,
      texte: cleanTexte,
      createdAt: now,
      updatedAt: now
    };
    list.push(resume);
    await saveResumeList(kv, list);

    return json({ ok: true, resume });
  } catch (err) {
    return json({ error: "Erreur lors de l'enregistrement du résumé : " + err.message }, 500);
  }
}

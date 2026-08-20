import { requireAdmin, json } from './_shared.js';

const MAX_SIZE = 8 * 1024 * 1024; // 8 Mo

const OCR_PROMPT = `Tu analyses la photo d'une ou plusieurs pages de cours (manuscrites ou imprimées), destinées à des élèves du primaire au Bénin.

La photo peut contenir UN SEUL résumé de cours, ou PLUSIEURS résumés distincts (par exemple plusieurs leçons séparées, ou des sections clairement différentes avec chacune son propre titre/sujet).

Pour CHAQUE résumé distinct que tu identifies sur la photo :
1. Transcris fidèlement tout son texte, en français, en respectant au mieux les paragraphes.
2. Devine si possible :
   - la matière (ex: Mathématiques, Français, Sciences d'observation, Histoire...)
   - un titre court (ex: "Les fractions — leçon 3")
   - la classe si elle est explicitement écrite (ex: "CE2", "CM1", "CI", "CP", "Maternelle"). Laisse vide si non visible.

Réponds UNIQUEMENT avec un objet JSON strict, sans aucun texte autour, sans balises markdown, au format exact :
{"resumes":[{"matiere":"...","classe_brute":"...","titre":"...","texte":"..."}]}

S'il n'y a qu'un seul résumé sur la photo, le tableau "resumes" ne contient qu'un seul élément. Si une information n'est pas trouvable, mets une chaîne vide "" pour ce champ (jamais pour "texte").`;

function mapClasseBrute(raw) {
  const s = (raw || '').toLowerCase();
  if (!s) return '';
  if (/\bci\b/.test(s)) return 'CI';
  if (/\bcp\b/.test(s)) return 'CP';
  if (/\bce1\b/.test(s)) return 'CE1';
  if (/\bce2\b/.test(s)) return 'CE2';
  if (/\bcm1\b/.test(s)) return 'CM1';
  if (/\bcm2\b/.test(s)) return 'CM2';
  return '';
}

function extractJson(raw) {
  const cleaned = (raw || '').trim().replace(/^```json\s*|^```\s*|```$/g, '');
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start === -1 || end === -1) return null;
  try {
    return JSON.parse(cleaned.slice(start, end + 1));
  } catch {
    return null;
  }
}

export async function onRequestPost(context) {
  const { request, env } = context;
  try {
    const formData = await request.formData();
    const token = formData.get('token');
    if (!(await requireAdmin(env, token))) return json({ error: 'Non autorisé' }, 401);

    const file = formData.get('image');
    if (!file || typeof file === 'string') {
      return json({ error: "Aucune image reçue" }, 400);
    }
    if (!file.type || !file.type.startsWith('image/')) {
      return json({ error: "Le fichier envoyé n'est pas une image" }, 400);
    }
    if (file.size > MAX_SIZE) {
      return json({ error: "Image trop volumineuse (8 Mo max)" }, 413);
    }

    const bytes = new Uint8Array(await file.arrayBuffer());

    const result = await env.AI.run('@cf/meta/llama-3.2-11b-vision-instruct', {
      prompt: OCR_PROMPT,
      image: Array.from(bytes),
      max_tokens: 3000
    });

    const raw = (result && (result.response || result.description || '')).trim();
    if (!raw) {
      return json({ error: "L'IA n'a pas réussi à extraire de texte de cette image. Réessaie avec une photo plus nette." }, 422);
    }

    const parsed = extractJson(raw);
    let items = parsed && Array.isArray(parsed.resumes) ? parsed.resumes : null;

    // Repli : si le modèle n'a pas rendu de JSON exploitable, on garde tout comme un seul texte brut
    if (!items || items.length === 0) {
      items = [{ matiere: '', classe_brute: '', titre: '', texte: raw }];
    }

    const resumes = items
      .map(it => ({
        texte: (it.texte || '').trim(),
        matiere: (it.matiere || '').trim(),
        titre: (it.titre || '').trim(),
        classe: mapClasseBrute(it.classe_brute)
      }))
      .filter(it => it.texte);

    if (resumes.length === 0) {
      return json({ error: "L'IA n'a rien pu extraire de cette image. Réessaie avec une photo plus nette." }, 422);
    }

    return json({ ok: true, resumes });
  } catch (err) {
    return json({ error: "Erreur lors de l'extraction du texte (OCR) : " + err.message }, 500);
  }
}

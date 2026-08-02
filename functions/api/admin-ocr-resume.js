import { requireAdmin, json } from './_shared.js';

const MAX_SIZE = 8 * 1024 * 1024; // 8 Mo

const OCR_PROMPT = `Tu analyses la photo d'une page de cours (manuscrite ou imprimée), destinée à des élèves du primaire au Bénin.

1. Transcris fidèlement tout le texte visible, en français, en respectant au mieux les paragraphes.
2. Devine, si possible à partir du contenu ou d'un en-tête visible sur la page :
   - la matière (ex: Mathématiques, Français, Sciences d'observation, Histoire...)
   - un titre court pour ce résumé (ex: "Les fractions — leçon 3")
   - la classe si elle est explicitement écrite sur la page (ex: "CE2", "CM1", "CI", "CP", "Maternelle"). Laisse vide si tu ne la vois pas clairement écrite.

Réponds UNIQUEMENT avec un objet JSON strict, sans aucun texte autour, sans balises markdown, au format exact :
{"matiere":"...","classe_brute":"...","titre":"...","texte":"..."}

Si une information n'est pas trouvable, mets une chaîne vide "" pour ce champ (jamais pour "texte").`;

function mapClasseBrute(raw) {
  const s = (raw || '').toLowerCase();
  if (!s) return '';
  if (s.includes('matern')) return 'maternelle';
  if (/\bci\b/.test(s) || /\bcp\b/.test(s)) return 'ci-cp';
  if (/\bce1\b|\bce2\b|\bcm1\b|\bcm2\b/.test(s)) return 'ce1-cm2';
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
      max_tokens: 2048
    });

    const raw = (result && (result.response || result.description || '')).trim();
    if (!raw) {
      return json({ error: "L'IA n'a pas réussi à extraire de texte de cette image. Réessaie avec une photo plus nette." }, 422);
    }

    const parsed = extractJson(raw);

    // Repli : si le modèle n'a pas rendu de JSON exploitable, on garde tout comme texte brut
    const texte = (parsed && parsed.texte ? parsed.texte : raw).trim();
    if (!texte) {
      return json({ error: "L'IA n'a pas réussi à extraire de texte de cette image. Réessaie avec une photo plus nette." }, 422);
    }

    return json({
      ok: true,
      texte,
      matiere: (parsed && parsed.matiere) || '',
      titre: (parsed && parsed.titre) || '',
      classe: mapClasseBrute(parsed && parsed.classe_brute)
    });
  } catch (err) {
    return json({ error: "Erreur lors de l'extraction du texte (OCR) : " + err.message }, 500);
  }
}

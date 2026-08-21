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

/* ---------- Rapprochement de la matière devinée par l'IA vers un libellé
   officiel ---------- */
/* ⚠️ Catalogue des matières par classe, à maintenir manuellement synchronisé
   avec admin-dashboard.html (CE1_CM2_MATIERES / CP_MATIERES / CI_MATIERES)
   et index.html (RESUME_MATIERES_PAR_CLASSE), qui définissent la liste
   officielle utilisée pour classer et filtrer les résumés côté enseignant. */
const CE1_CM2_MATIERES = [
  'VOCABULAIRE THÉMATIQUE', 'VOCABULAIRE FONCTIONNEL', 'VOCABULAIRE SYSTÉMATIQUE',
  'COMMUNICATION ORALE', 'EXPRESSION ÉCRITE', 'GRAMMAIRE', 'ORTHOGRAPHE', 'CONJUGAISON',
  'MATHÉMATIQUE', 'ES CIVISME', 'ES MORALE', 'ES GÉOGRAPHIE', 'ES HISTOIRE', 'EST',
  'LECTURE ORALISÉE', 'LECTURE SILENCIEUSE', 'LECTURE AUDITION', 'ÉCRITURE'
];
const CP_MATIERES = [
  'FRANÇAIS : COMMUNICATION ORALE 1', 'FRANÇAIS : COMMUNICATION ORALE 2', 'MATHÉMATIQUES',
  'FRANÇAIS : INTÉGRATION', 'FRANÇAIS : LECTURE ÉCRITURE (ÉTAPES 1 ET 2)',
  'FRANÇAIS : LECTURE ÉCRITURE (ÉTAPE 3)', 'FRANÇAIS : LECTURE ÉCRITURE (ÉTAPE 4)',
  'FRANÇAIS : LECTURE ÉCRITURE (ÉTAPE 5)', 'FRANÇAIS : LECTURE ÉCRITURE (ÉTAPE 6)',
  'FRANÇAIS : LECTURE ÉCRITURE (ÉTAPE 7)', 'FRANÇAIS : LECTURE ÉCRITURE (ÉTAPE 8)',
  'FRANÇAIS : LECTURE ÉCRITURE (ÉTAPE 9)', 'FRANÇAIS : STRUCTURE DE LA LANGUE'
];
const CI_MATIERES = [
  'FRANÇAIS : COMMUNICATION ORALE 1, 2, 3', 'GRAPHISME', 'MATHÉMATIQUES',
  "INITIATION À L'ÉDUCATION SOCIALE", "INITIATION À L'ÉDUCATION SCIENTIFIQUE ET TECHNOLOGIQUE",
  "INITIATION À L'ÉDUCATION PHYSIQUE ET SPORTIVE", 'INITIATION À LA LECTURE', 'LECTURE RÉCRÉATIVE',
  ...CP_MATIERES
];
const MATIERES_PAR_CLASSE = {
  CI: CI_MATIERES, CP: CP_MATIERES,
  CE1: CE1_CM2_MATIERES, CE2: CE1_CM2_MATIERES, CM1: CE1_CM2_MATIERES, CM2: CE1_CM2_MATIERES
};
const TOUTES_MATIERES = Array.from(new Set([...CE1_CM2_MATIERES, ...CP_MATIERES, ...CI_MATIERES]));

/* Normalise (majuscules, sans accents, ponctuation réduite à des espaces)
   pour comparer un texte libre à un libellé officiel sans être gêné par la
   casse, les accents ou la ponctuation. */
function foldText(s) {
  return (s || '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, ' ')
    .trim();
}

/* Mots-clés usuels employés par l'IA -> libellé(s) officiel(s) correspondant(s),
   utilisés en dernier recours quand la correspondance exacte ou par inclusion
   échoue (formulation générique de l'IA : "Mathématiques", "Sciences
   d'observation", "Histoire"...). */
const KEYWORD_MATCHES = [
  [/\bMATH/, ['MATHÉMATIQUE', 'MATHÉMATIQUES']],
  [/(SCIENCE|OBSERVATION|\bEST\b)/, ['EST']],
  [/HISTOIRE/, ['ES HISTOIRE']],
  [/GEOGRAPHIE/, ['ES GÉOGRAPHIE']],
  [/CIVISME/, ['ES CIVISME']],
  [/MORALE/, ['ES MORALE']],
  [/GRAMMAIRE/, ['GRAMMAIRE']],
  [/ORTHOGRAPHE/, ['ORTHOGRAPHE']],
  [/CONJUGAISON/, ['CONJUGAISON']],
  [/VOCABULAIRE.*THEMATIQUE|THEMATIQUE/, ['VOCABULAIRE THÉMATIQUE']],
  [/VOCABULAIRE.*FONCTIONNEL|FONCTIONNEL/, ['VOCABULAIRE FONCTIONNEL']],
  [/VOCABULAIRE.*SYSTEMATIQUE|SYSTEMATIQUE/, ['VOCABULAIRE SYSTÉMATIQUE']],
  [/EXPRESSION ECRITE/, ['EXPRESSION ÉCRITE']],
  [/COMMUNICATION ORALE/, ['COMMUNICATION ORALE', 'FRANÇAIS : COMMUNICATION ORALE 1', 'FRANÇAIS : COMMUNICATION ORALE 1, 2, 3']],
  [/LECTURE RECREA/, ['LECTURE RÉCRÉATIVE']],
  [/LECTURE ORAL/, ['LECTURE ORALISÉE']],
  [/LECTURE SILENC/, ['LECTURE SILENCIEUSE']],
  [/LECTURE AUDIT/, ['LECTURE AUDITION']],
  [/INITIATION.*LECTURE/, ['INITIATION À LA LECTURE']],
  [/\bECRITURE\b/, ['ÉCRITURE']],
  [/GRAPHISME/, ['GRAPHISME']],
  [/EDUCATION SOCIALE/, ["INITIATION À L'ÉDUCATION SOCIALE"]],
  [/EDUCATION.*(SCIENTIF|TECHNO)/, ["INITIATION À L'ÉDUCATION SCIENTIFIQUE ET TECHNOLOGIQUE"]],
  [/(EDUCATION PHYSIQUE|SPORTIVE|\bEPS\b)/, ["INITIATION À L'ÉDUCATION PHYSIQUE ET SPORTIVE"]],
  [/STRUCTURE DE LA LANGUE/, ['FRANÇAIS : STRUCTURE DE LA LANGUE']],
  [/INTEGRATION/, ['FRANÇAIS : INTÉGRATION']]
];

/* Rapproche la matière brute devinée par l'IA d'un libellé officiel (celui
   utilisé par le menu déroulant "Matière" de l'espace admin et par les
   filtres côté enseignant), pour que le résumé soit classé correctement dès
   son ajout. Si aucune correspondance fiable n'est trouvée, renvoie une
   chaîne vide (le champ reste alors à choisir manuellement — préférable à
   une matière incorrecte). */
function mapMatiereBrute(raw, classe) {
  const cleaned = foldText(raw);
  if (!cleaned) return '';
  const candidates = (classe && MATIERES_PAR_CLASSE[classe]) || TOUTES_MATIERES;

  const exact = candidates.find(m => foldText(m) === cleaned);
  if (exact) return exact;

  const contains = candidates.filter(m => {
    const fm = foldText(m);
    return cleaned.includes(fm) || fm.includes(cleaned);
  });
  if (contains.length === 1) return contains[0];

  for (const [re, labels] of KEYWORD_MATCHES) {
    if (re.test(cleaned)) {
      const found = labels.find(l => candidates.includes(l));
      if (found) return found;
    }
  }
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
      .map(it => {
        const classe = mapClasseBrute(it.classe_brute);
        return {
          texte: (it.texte || '').trim(),
          matiere: mapMatiereBrute(it.matiere, classe),
          titre: (it.titre || '').trim(),
          classe
        };
      })
      .filter(it => it.texte);

    if (resumes.length === 0) {
      return json({ error: "L'IA n'a rien pu extraire de cette image. Réessaie avec une photo plus nette." }, 422);
    }

    return json({ ok: true, resumes });
  } catch (err) {
    return json({ error: "Erreur lors de l'extraction du texte (OCR) : " + err.message }, 500);
  }
}

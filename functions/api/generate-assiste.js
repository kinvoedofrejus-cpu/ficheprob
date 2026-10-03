import { json } from './_shared.js';

/*
  Endpoint IA pour le Mode Assisté.
  Reçoit : matière, classe, titre de la leçon, démarche pédagogique, et la liste
  des champs ("items") à générer pour cette fiche. Renvoie pour chaque item un
  texte de consignes généré par l'IA (Cloudflare Workers AI), rédigé dans un
  français adapté au niveau de classe indiqué, et basé sur la démarche fournie.

  Corps attendu (POST, JSON) :
  {
    "matiere": "lectureOralisee",       // clé interne de la matière (sert juste de contexte)
    "classe": "CE1",                     // niveau de classe, pour adapter le langage
    "titre": "Le chat et la souris",     // titre de la leçon saisi par l'enseignant
    "support": "texte support éventuel", // optionnel : texte support de la leçon
    "demarche": "texte complet de la démarche pédagogique propre à la matière",
    "items": [
      { "label": "Mise en situation", "consigne": "Décris ce qu'il faut générer pour cet item" },
      { "label": "Activités de construction de nouveaux savoirs", "consigne": "..." }
    ]
  }

  Réponse :
  { ok: true, items: { "Mise en situation": "texte généré...", ... } }

  Modèle utilisé : @cf/meta/llama-3.1-8b-instruct (rapide, suffisant pour du texte
  pédagogique court). Le binding "AI" est déclaré dans wrangler.toml ([ai] binding = "AI").
*/

const MODEL = '@cf/meta/llama-3.1-8b-instruct';

/* Angles de formulation tirés au hasard à chaque appel (en plus de la
   température élevée) : objectif, qu'un enseignant A et un enseignant B qui
   génèrent une fiche avec EXACTEMENT le même titre n'obtiennent jamais la
   même rédaction (demande du 03/10/2026 : "les fiches ne doivent jamais
   être les mêmes d'un enseignant à un autre, même si c'est le même titre"). */
const STYLE_ANGLES = [
  "Privilégie des phrases courtes et dynamiques.",
  "Varie le choix des mots : évite les formulations les plus évidentes ou les plus attendues.",
  "Adopte un ton chaleureux et encourageant, comme si tu parlais directement à la classe.",
  "Commence certaines consignes par un verbe d'action différent de ceux qu'on utilise le plus souvent dans ce genre de fiche.",
  "Change l'ordre habituel des mots dans certaines phrases, tout en restant naturel et clair.",
  "Utilise des synonymes plutôt que les mots les plus courants pour ce type de consigne.",
  "Formule tes phrases comme si c'était la première fois que tu abordais ce titre, sans te répéter."
];

function buildPrompt({ matiere, classe, titre, support, demarche, items }) {
  const itemsList = items.map((it, i) =>
    `${i + 1}. Champ "${it.label}" : ${it.consigne || 'Génère le contenu pédagogique attendu pour ce champ, en te basant sur la démarche.'}`
  ).join('\n');
  const angle = STYLE_ANGLES[Math.floor(Math.random() * STYLE_ANGLES.length)];
  const variationId = Math.random().toString(36).slice(2, 10);

  return `Tu es un conseiller pédagogique béninois qui aide un enseignant à préparer une fiche de leçon pour la classe de ${classe || 'CE1-CM2'}, matière : ${matiere}.

Important : un autre enseignant pourrait un jour te demander exactement le même titre de leçon, dans la même matière et la même classe. Sa fiche ne doit JAMAIS être rédigée mot pour mot comme celle-ci. Pour cette génération précise (identifiant interne ${variationId}), applique cette consigne de style : ${angle}

Démarche pédagogique officielle, à respecter OBLIGATOIREMENT et dans l'ORDRE pour chaque champ (c'est la règle la plus importante : chaque champ que tu rédiges doit correspondre exactement à l'étape de cette démarche à laquelle il correspond — ni une étape sautée, ni une étape inventée qui n'y figure pas) :
"""
${demarche}
"""

Titre de la leçon donné par l'enseignant : "${titre}"
${support ? `Texte support de la leçon :\n"""\n${support}\n"""\n` : ''}

Pour chaque champ listé ci-dessous :
1. Identifie d'abord à quelle étape de la démarche ci-dessus ce champ correspond.
2. Rédige ensuite le contenu RÉEL à exécuter pour cette étape précise — des consignes/questions/activités concrètes, adaptées au titre et, si fourni, au texte support — dans un français simple, clair et adapté au niveau de la classe ${classe || 'CE1-CM2'}.
Tu es libre d'inventer de nouvelles questions ou activités (ne recopie jamais la démarche mot pour mot, et ne te contente jamais d'un résumé générique) : l'important est que ce que tu inventes reste toujours dans le sens, l'esprit et l'objectif de cette étape de la démarche — jamais une activité hors sujet par rapport à ce qu'elle demande. Le contenu doit rester concret et directement utilisable par l'enseignant devant ses élèves.

Champs à générer :
${itemsList}

Réponds UNIQUEMENT avec un objet JSON valide, sans aucun texte autour, au format exact :
{"items": {"<label exact du champ>": "<contenu généré>", ...}}

Pour chaque champ, le contenu doit être une chaîne de texte, avec les consignes séparées par des retours à la ligne "\\n" si plusieurs consignes sont nécessaires.`;
}

function extractJson(text) {
  if (!text) return null;
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) return null;
  const slice = text.slice(start, end + 1);
  try {
    return JSON.parse(slice);
  } catch (e) {
    return null;
  }
}

export async function onRequestPost(context) {
  const { request, env } = context;

  if (!env.AI) {
    return json({ error: 'IA non configurée sur ce déploiement (binding AI manquant).' }, 500);
  }

  let body;
  try {
    body = await request.json();
  } catch (e) {
    return json({ error: 'Corps de requête invalide (JSON attendu).' }, 400);
  }

  const { matiere, classe, titre, support, demarche, items } = body || {};

  if (!matiere || !titre || !demarche || !Array.isArray(items) || !items.length) {
    return json({ error: 'Champs requis manquants : matiere, titre, demarche, items.' }, 400);
  }

  const prompt = buildPrompt({ matiere, classe, titre, support, demarche, items });

  try {
    const aiResponse = await env.AI.run(MODEL, {
      messages: [
        { role: 'system', content: 'Tu réponds toujours uniquement avec un objet JSON valide, sans texte explicatif autour.' },
        { role: 'user', content: prompt }
      ],
      max_tokens: 1800,
      temperature: 1.0,
      top_p: 0.95
    });

    const rawText = (aiResponse && (aiResponse.response || aiResponse.result || aiResponse)) || '';
    const textStr = typeof rawText === 'string' ? rawText : JSON.stringify(rawText);
    const parsed = extractJson(textStr);

    if (!parsed || !parsed.items) {
      return json({ error: 'Réponse IA invalide (format JSON non trouvé).', raw: textStr }, 502);
    }

    return json({ ok: true, items: parsed.items });
  } catch (err) {
    return json({ error: 'Erreur IA : ' + err.message }, 500);
  }
}

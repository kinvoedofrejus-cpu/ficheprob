import { normalizePhone, json, getUser } from './_shared.js';

// Cloudflare Function — /api/generate-image
//
// Illustration pédagogique générée par Workers AI (texte → image) puis rangée dans le même espace R2 que les
// images ajoutées à la main (/api/upload-image) : l'URL renvoyée s'utilise donc exactement comme une image
// d'enseignant (aperçu, export PDF, suppression).
//   requête  { phone, code, prompt }        (compte actif obligatoire : la génération d'image a un coût)
//   réponse  { ok:true, url } ou { ok:false, reason }
//
// Modèles (réglables : variable IMAGE_MODELS, liste séparée par des virgules) :
// 1) FLUX.1 schnell — rapide, bonne qualité ; 2) SDXL Lightning — secours.

const DEFAULT_IMAGE_MODELS = [
  '@cf/black-forest-labs/flux-1-schnell',
  '@cf/bytedance/stable-diffusion-xl-lightning'
];
const STYLE =
  'Simple, clear, colorful flat educational illustration for primary school children, ' +
  'friendly cartoon style, plain white background, centered subject, no text, no letters, no numbers, no watermark. ';
const MAX_BYTES = 4 * 1024 * 1024;

function b64ToBytes(b64) {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

// Les modèles renvoient soit { image: "<base64>" }, soit directement les octets de l'image.
async function toBytes(result) {
  if (result && typeof result === 'object' && typeof result.image === 'string') return b64ToBytes(result.image);
  if (result instanceof Uint8Array) return result;
  if (result instanceof ArrayBuffer) return new Uint8Array(result);
  if (typeof ReadableStream !== 'undefined' && result instanceof ReadableStream) {
    return new Uint8Array(await new Response(result).arrayBuffer());
  }
  if (typeof Response !== 'undefined' && result instanceof Response) return new Uint8Array(await result.arrayBuffer());
  return null;
}

function sniffType(bytes) {
  if (bytes[0] === 0x89 && bytes[1] === 0x50) return { type: 'image/png', ext: 'png' };
  if (bytes[0] === 0x52 && bytes[1] === 0x49) return { type: 'image/webp', ext: 'webp' };
  return { type: 'image/jpeg', ext: 'jpg' };
}

async function generate(env, prompt) {
  const models = env.IMAGE_MODELS
    ? String(env.IMAGE_MODELS).split(',').map(x => x.trim()).filter(Boolean)
    : DEFAULT_IMAGE_MODELS;
  let lastErr = null;
  for (const model of models) {
    try {
      const params = model.includes('flux') ? { prompt, steps: 4 } : { prompt };
      const bytes = await toBytes(await env.AI.run(model, params));
      if (bytes && bytes.length > 1000) return bytes;
      lastErr = new Error('image vide');
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr || new Error('génération impossible');
}

export async function onRequestPost(context) {
  const { request, env } = context;
  try {
    if (!env.AI || !env.FPB_IMAGES) return json({ ok: false, reason: 'not-configured' }, 501);
    const body = await request.json();
    const phoneDigits = normalizePhone(body.phone);
    const cleanCode = String(body.code || '').trim().toUpperCase();
    if (phoneDigits.length < 8 || !cleanCode) return json({ ok: false, reason: 'invalid' }, 400);

    const record = await getUser(env.FPB_DB, phoneDigits);
    if (!record || (record.code || '').toUpperCase() !== cleanCode) return json({ ok: false, reason: 'invalid' }, 401);
    if (!record.active) return json({ ok: false, reason: 'inactive' }, 403);
    if (record.expiryTs <= Date.now()) return json({ ok: false, reason: 'expired' }, 403);

    const subject = String(body.prompt || '').replace(/[\u0000-\u001f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 300);
    if (subject.length < 6) return json({ ok: false, reason: 'no-prompt' }, 400);

    const bytes = await generate(env, STYLE + subject);
    if (bytes.length > MAX_BYTES) return json({ ok: false, reason: 'too-large' }, 413);
    const { type, ext } = sniffType(bytes);
    const key = `${phoneDigits}/${Date.now()}-${crypto.randomUUID()}.${ext}`;
    await env.FPB_IMAGES.put(key, bytes, { httpMetadata: { contentType: type } });
    return json({ ok: true, url: `/api/get-image?key=${encodeURIComponent(key)}` });
  } catch (err) {
    return json({ ok: false, reason: 'ai-busy', error: "Erreur lors de la génération de l'image : " + err.message }, 503);
  }
}

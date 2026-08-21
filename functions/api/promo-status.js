// Alias de get-promo.js : même logique, juste un nom de route différent
// pour correspondre à l'appel `/api/promo-status` fait depuis index.html
// (utile surtout pour le déploiement Cloudflare Pages Functions, où chaque
// fichier = une route basée sur son nom).
export { onRequestGet } from './get-promo.js';

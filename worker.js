import * as adminLogin from './functions/api/admin-login.js';
import * as adminGenerateCode from './functions/api/admin-generate-code.js';
import * as adminListUsers from './functions/api/admin-list-users.js';
import * as adminPayments from './functions/api/admin-payments.js';
import * as adminResetCode from './functions/api/admin-reset-code.js';
import * as adminSetActive from './functions/api/admin-set-active.js';
import * as adminStats from './functions/api/admin-stats.js';
import * as adminUpdatePhone from './functions/api/admin-update-phone.js';
import * as adminUpdateProfile from './functions/api/admin-update-profile.js';
import * as adminBulkAssign from './functions/api/admin-bulk-assign.js';
import * as paymentStatus from './functions/api/payment-status.js';
import * as userLogin from './functions/api/user-login.js';
import * as recordUsage from './functions/api/record-usage.js';
import * as webhook from './functions/api/webhook.js';
import * as adminListPromos from './functions/api/admin-list-promos.js';
import * as adminAddPromo from './functions/api/admin-add-promo.js';
import * as adminDeletePromo from './functions/api/admin-delete-promo.js';
import * as getPromo from './functions/api/get-promo.js';
import * as promoStatus from './functions/api/promo-status.js';
import * as claimFreePlan from './functions/api/claim-free-plan.js';
import * as adminDeleteUser from './functions/api/admin-delete-user.js';
import * as setClasse from './functions/api/set-classe.js';
import * as uploadImage from './functions/api/upload-image.js';
import * as getImage from './functions/api/get-image.js';
import * as deleteImage from './functions/api/delete-image.js';
import * as adminSaveResume from './functions/api/admin-save-resume.js';
import * as adminListResumes from './functions/api/admin-list-resumes.js';
import * as adminDeleteResume from './functions/api/admin-delete-resume.js';
import * as getResumes from './functions/api/get-resumes.js';
import * as createResumePayment from './functions/api/create-resume-payment.js';
import * as recordResumeDownload from './functions/api/record-resume-download.js';
import * as createPayment from './functions/api/create-payment.js';
import * as adminListHiddenMatieres from './functions/api/admin-list-hidden-matieres.js';
import * as adminToggleHiddenMatiere from './functions/api/admin-toggle-hidden-matiere.js';
import * as adminUploadResumeImage from './functions/api/admin-upload-resume-image.js';
import * as adminDeleteResumeImage from './functions/api/admin-delete-resume-image.js';
import * as createReadyFichePayment from './functions/api/create-readyfiche-payment.js';
import * as getReadyFicheStatus from './functions/api/get-readyfiche-status.js';
import * as recordReadyFicheDownload from './functions/api/record-readyfiche-download.js';
import * as getReadyFichePdf from './functions/api/get-readyfiche-pdf.js';
import * as getReadyFicheMeta from './functions/api/get-readyfiche-meta.js';
import * as getReadyFicheDocx from './functions/api/get-readyfiche-docx.js';
import * as getReadyFicheDocxList from './functions/api/get-readyfiche-docx-list.js';
import * as adminUploadReadyFichePdf from './functions/api/admin-upload-readyfiche-pdf.js';
import * as adminListReadyFichePdfs from './functions/api/admin-list-readyfiche-pdfs.js';
import * as adminBackupList from './functions/api/admin-backup-list.js';
import * as adminBackupFile from './functions/api/admin-backup-file.js';
import * as generateAssiste from './functions/api/generate-assiste.js';
import * as generateImage from './functions/api/generate-image.js';
import * as submitAmbassador from './functions/api/submit-ambassador.js';
import * as adminListAmbassadors from './functions/api/admin-list-ambassadors.js';
import * as adminUpdateAmbassador from './functions/api/admin-update-ambassador.js';
import * as getResourcePdf from './functions/api/get-resource-pdf.js';
import * as getResourceMeta from './functions/api/get-resource-meta.js';
import * as adminUploadResourcePdf from './functions/api/admin-upload-resource-pdf.js';
import * as claimFirstDownload from './functions/api/claim-first-download.js';
import * as createResourcePayment from './functions/api/create-resource-payment.js';
import * as appModeStatus from './functions/api/app-mode-status.js';
import * as adminSetAppMode from './functions/api/admin-set-app-mode.js';
import * as adminSetFreeLimits from './functions/api/admin-set-free-limits.js';
import * as adminSetDownloadPolicy from './functions/api/admin-set-download-policy.js';
import * as adminGetAppSettings from './functions/api/admin-get-app-settings.js';
import * as adminSetMinPlanBonus from './functions/api/admin-set-min-plan-bonus.js';
import * as adminGrantBonusNow from './functions/api/admin-grant-bonus-now.js';
import * as adminSetPlanPrices from './functions/api/admin-set-plan-prices.js';
import * as getPlans from './functions/api/get-plans.js';
import * as getReadyFichePrices from './functions/api/get-readyfiche-prices.js';
import * as adminSetReadyFichePrices from './functions/api/admin-set-readyfiche-prices.js';
import * as generatePoints from './functions/api/generate-points.js';
import * as ambassadorStatus from './functions/api/ambassador-status.js';
import * as adminToggleHiddenClasse from './functions/api/admin-toggle-hidden-classe.js';
import * as paperOrderConfig from './functions/api/paper-order-config.js';
import * as adminSetPaperConfig from './functions/api/admin-set-paper-config.js';
import * as createPaperOrder from './functions/api/create-paper-order.js';
import * as payPaperOrder from './functions/api/pay-paper-order.js';
import * as paperOrderStatus from './functions/api/paper-order-status.js';
import * as adminListPaperOrders from './functions/api/admin-list-paper-orders.js';
import * as adminUpdatePaperOrder from './functions/api/admin-update-paper-order.js';
import * as uploadPaperProof from './functions/api/upload-paper-proof.js';
import * as paperCountPages from './functions/api/paper-count-pages.js';
import * as listCustomResources from './functions/api/list-custom-resources.js';
import * as adminAddCustomResource from './functions/api/admin-add-custom-resource.js';
import * as adminDeleteCustomResource from './functions/api/admin-delete-custom-resource.js';
import * as adminGetPaperProof from './functions/api/admin-get-paper-proof.js';

const routes = {
  '/api/admin-login': adminLogin,
  '/api/admin-generate-code': adminGenerateCode,
  '/api/admin-list-users': adminListUsers,
  '/api/admin-payments': adminPayments,
  '/api/admin-reset-code': adminResetCode,
  '/api/admin-set-active': adminSetActive,
  '/api/admin-stats': adminStats,
  '/api/admin-update-phone': adminUpdatePhone,
  '/api/admin-update-profile': adminUpdateProfile,
  '/api/admin-bulk-assign': adminBulkAssign,
  '/api/payment-status': paymentStatus,
  '/api/user-login': userLogin,
  '/api/record-usage': recordUsage,
  '/api/webhook': webhook,
  '/api/admin-list-promos': adminListPromos,
  '/api/admin-add-promo': adminAddPromo,
  '/api/admin-delete-promo': adminDeletePromo,
  '/api/get-promo': getPromo,
  '/api/promo-status': promoStatus,
  '/api/claim-free-plan': claimFreePlan,
  '/api/admin-delete-user': adminDeleteUser,
  '/api/set-classe': setClasse,
  '/api/upload-image': uploadImage,
  '/api/get-image': getImage,
  '/api/delete-image': deleteImage,
  '/api/admin-save-resume': adminSaveResume,
  '/api/admin-list-resumes': adminListResumes,
  '/api/admin-delete-resume': adminDeleteResume,
  '/api/get-resumes': getResumes,
  '/api/create-resume-payment': createResumePayment,
  '/api/record-resume-download': recordResumeDownload,
  '/api/create-payment': createPayment,
  '/api/admin-list-hidden-matieres': adminListHiddenMatieres,
  '/api/admin-toggle-hidden-matiere': adminToggleHiddenMatiere,
  '/api/admin-upload-resume-image': adminUploadResumeImage,
  '/api/admin-delete-resume-image': adminDeleteResumeImage,
  '/api/create-readyfiche-payment': createReadyFichePayment,
  '/api/get-readyfiche-status': getReadyFicheStatus,
  '/api/record-readyfiche-download': recordReadyFicheDownload,
  '/api/get-readyfiche-pdf': getReadyFichePdf,
  '/api/get-readyfiche-meta': getReadyFicheMeta,
  '/api/get-readyfiche-docx': getReadyFicheDocx,
  '/api/get-readyfiche-docx-list': getReadyFicheDocxList,
  '/api/admin-upload-readyfiche-pdf': adminUploadReadyFichePdf,
  '/api/admin-list-readyfiche-pdfs': adminListReadyFichePdfs,
  '/api/admin-backup-list': adminBackupList,
  '/api/admin-backup-file': adminBackupFile,
  '/api/generate-assiste': generateAssiste,
  '/api/generate-image': generateImage,
  '/api/get-resource-pdf': getResourcePdf,
  '/api/get-resource-meta': getResourceMeta,
  '/api/admin-upload-resource-pdf': adminUploadResourcePdf,
  '/api/claim-first-download': claimFirstDownload,
  '/api/create-resource-payment': createResourcePayment,
  '/api/app-mode-status': appModeStatus,
  '/api/admin-set-app-mode': adminSetAppMode,
  '/api/admin-set-free-limits': adminSetFreeLimits,
  '/api/admin-set-download-policy': adminSetDownloadPolicy,
  '/api/admin-get-app-settings': adminGetAppSettings,
  '/api/admin-set-min-plan-bonus': adminSetMinPlanBonus,
  '/api/admin-grant-bonus-now': adminGrantBonusNow,
  '/api/admin-set-plan-prices': adminSetPlanPrices,
  '/api/get-plans': getPlans,
  '/api/get-readyfiche-prices': getReadyFichePrices,
  '/api/admin-set-readyfiche-prices': adminSetReadyFichePrices,
  '/api/submit-ambassador': submitAmbassador,
  '/api/admin-list-ambassadors': adminListAmbassadors,
  '/api/admin-update-ambassador': adminUpdateAmbassador,
  '/api/generate-points': generatePoints,
  '/api/ambassador-status': ambassadorStatus,
  '/api/admin-toggle-hidden-classe': adminToggleHiddenClasse,
  '/api/paper-order-config': paperOrderConfig,
  '/api/admin-set-paper-config': adminSetPaperConfig,
  '/api/create-paper-order': createPaperOrder,
  '/api/pay-paper-order': payPaperOrder,
  '/api/paper-order-status': paperOrderStatus,
  '/api/admin-list-paper-orders': adminListPaperOrders,
  '/api/admin-update-paper-order': adminUpdatePaperOrder,
  '/api/upload-paper-proof': uploadPaperProof,
  '/api/paper-count-pages': paperCountPages,
  '/api/list-custom-resources': listCustomResources,
  '/api/admin-add-custom-resource': adminAddCustomResource,
  '/api/admin-delete-custom-resource': adminDeleteCustomResource,
  '/api/admin-get-paper-proof': adminGetPaperProof,
};

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const mod = routes[url.pathname];

    if (mod) {
      const handlerName = 'onRequest' + request.method.charAt(0) + request.method.slice(1).toLowerCase();
      const handler = mod[handlerName] || mod.onRequest;
      if (handler) {
        return handler({ request, env, waitUntil: ctx.waitUntil.bind(ctx), params: {} });
      }
      return new Response('Method not allowed', { status: 405 });
    }

    // Application ADMIN installable : adresse stable « /admin/ » (sans « .html », donc sans redirection de Cloudflare,
    // ce qui permet au navigateur de proposer une vraie installation et non un simple raccourci).
    if (url.pathname === '/admin') return Response.redirect(url.origin + '/admin/' + url.search, 308);
    if (url.pathname === '/admin/' && (request.method === 'GET' || request.method === 'HEAD')) {
      for (const p of ['/admin-dashboard', '/admin-dashboard.html']) {
        let r = await env.ASSETS.fetch(new Request(new URL(p, url), { headers: request.headers }));
        if (r.status >= 300 && r.status < 400 && r.headers.get('location')) {
          r = await env.ASSETS.fetch(new Request(new URL(r.headers.get('location'), url), { headers: request.headers }));
        }
        if (r.status === 200) {
          const h = new Headers(r.headers);
          h.set('Content-Type', 'text/html; charset=utf-8');
          h.set('Cache-Control', 'no-cache');
          return new Response(r.body, { status: 200, headers: h });
        }
      }
      return new Response('Espace admin introuvable', { status: 404 });
    }

    // Sinon, sert les fichiers statiques (HTML, JS, images, etc.)
    return env.ASSETS.fetch(request);
  }
};

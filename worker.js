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
import * as adminOcrResume from './functions/api/admin-ocr-resume.js';
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
  '/api/admin-ocr-resume': adminOcrResume,
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

    // Sinon, sert les fichiers statiques (HTML, JS, images, etc.)
    return env.ASSETS.fetch(request);
  }
};

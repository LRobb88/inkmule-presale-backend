// Central config. Every integration is optional so the app can boot locally
// without credentials — missing integrations fall back to safe dev behavior
// (files on local disk, emails logged to console, etc.).

const env = process.env;

const config = {
  port: parseInt(env.PORT || '3000', 10),
  appUrl: (env.APP_URL || `http://localhost:${env.PORT || 3000}`).replace(/\/$/, ''),
  databaseUrl: env.DATABASE_URL || 'postgres://localhost/inkmule_proofing',
  sessionSecret: env.SESSION_SECRET || 'dev-only-secret-change-me',
  isProd: env.NODE_ENV === 'production',

  // Google sign-in (staff)
  // Tolerate stray spaces/quotes from pasting into Railway.
  googleClientId: (env.GOOGLE_CLIENT_ID || '').trim().replace(/^["']|["']$/g, ''),
  allowedDomain: (env.ALLOWED_DOMAIN || 'inkmule.com').toLowerCase(),
  // Local testing only: lets you sign in with any @ALLOWED_DOMAIN email, no Google.
  devAuth: env.DEV_AUTH === '1' && env.NODE_ENV !== 'production',

  // Dropbox
  dropbox: {
    appKey: env.DROPBOX_APP_KEY || '',
    appSecret: env.DROPBOX_APP_SECRET || '',
    refreshToken: env.DROPBOX_REFRESH_TOKEN || '',
    projectsRoot: (env.DROPBOX_PROJECTS_PATH || '/PROJECTS').replace(/\/$/, ''),
    proofsSubfolder: env.DROPBOX_PROOFS_SUBFOLDER || 'Proofs',
  },

  // S&S Activewear
  ss: {
    account: env.SS_ACCOUNT_NUMBER || '',
    apiKey: env.SS_API_KEY || '',
    baseUrl: (env.SS_API_BASE || 'https://api.ssactivewear.com/v2').replace(/\/$/, ''),
    imageBase: 'https://www.ssactivewear.com/',
    // {brandSlug} and {styleName} / {partNumber} are substituted. Reps can edit the link on the form.
    productUrlTemplate: env.SS_PRODUCT_URL_TEMPLATE || 'https://www.ssactivewear.com/p/{brandSlug}/{styleName}',
  },

  // Resend (customer proof emails + rep notifications)
  email: {
    resendApiKey: env.RESEND_API_KEY || '',
    from: env.EMAIL_FROM || 'proofs@inkmule.com',
    fromName: env.EMAIL_FROM_NAME || 'Inkmule Proofs',
  },

  // Missive REST API (posts on conversations)
  missive: {
    apiToken: env.MISSIVE_API_TOKEN || '',
    apiBase: 'https://public.missiveapp.com/v1',
  },

  maxFileMb: parseInt(env.MAX_FILE_MB || '100', 10),
};

module.exports = config;

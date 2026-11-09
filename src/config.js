require('dotenv').config();

module.exports = {
  whatsappToken: process.env.WHATSAPP_TOKEN,
  phoneNumberId: process.env.PHONE_NUMBER_ID,
  verifyToken: process.env.VERIFY_TOKEN,
  graphVersion: process.env.GRAPH_API_VERSION || 'v19.0',
  port: process.env.PORT || 3000,
  googleServiceAccountEmail: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL || '',
  googleServiceAccountKey: process.env.GOOGLE_SERVICE_ACCOUNT_KEY || '',
  dashboardUser: process.env.DASHBOARD_USER || 'admin',
  dashboardPassword: process.env.DASHBOARD_PASSWORD || '',
  firebaseProjectId: process.env.FIREBASE_PROJECT_ID || 'wa-automation-famebros-phase-1',
  firebaseServiceAccountJson: process.env.FIREBASE_SERVICE_ACCOUNT_JSON || '',
  business: {
    name: process.env.BUSINESS_NAME || 'Famebros Studio',
    phone: process.env.BUSINESS_PHONE || '+91 98923 84424',
    email: process.env.BUSINESS_EMAIL || 'growth@famebrosstudio.com',
    address: process.env.BUSINESS_ADDRESS || 'Mulund West, Mumbai - 400080',
    whatsappLink: process.env.WHATSAPP_LINK || 'https://wa.me/919892384424',
  },
};

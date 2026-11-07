require('dotenv').config();

module.exports = {
  whatsappToken: process.env.WHATSAPP_TOKEN,
  phoneNumberId: process.env.PHONE_NUMBER_ID,
  verifyToken: process.env.VERIFY_TOKEN,
  graphVersion: process.env.GRAPH_API_VERSION || 'v19.0',
  port: process.env.PORT || 3000,
  openaiKey: process.env.OPENAI_API_KEY || '',
  googleSheetsId: process.env.GOOGLE_SHEETS_ID || '',
  googleServiceAccountEmail: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL || '',
  googleServiceAccountKey: process.env.GOOGLE_SERVICE_ACCOUNT_KEY || '',
  adminPhone: process.env.ADMIN_PHONE || '',
  business: {
    name: process.env.BUSINESS_NAME || 'Famebros Studio',
    phone: process.env.BUSINESS_PHONE || '+91 98923 84424',
    email: process.env.BUSINESS_EMAIL || 'growth@famebrosstudio.com',
    address: process.env.BUSINESS_ADDRESS || 'Mulund West, Mumbai - 400080',
    whatsappLink: process.env.WHATSAPP_LINK || 'https://wa.me/919892384424',
  },
};

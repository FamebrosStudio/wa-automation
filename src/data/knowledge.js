const config = require('../config');

const B = config.business;

const WELCOME = `Hi! 👋 Welcome to Famebros Studio.

We're here to help you grow your business digitally. 🚀

What service are you looking for?`;

const ABOUT = `We're a social media marketing and content agency based in Mumbai. We combine strategy, creativity, and performance marketing to grow real businesses.

We've managed 50+ businesses, work with 500+ creators, and have a 25-person in-house team. Most of our clients come through referrals.

Want to know more about our services or packages?`;

const SERVICES = `We offer everything under one roof:

1. Social Media Management
2. Content and Reel Production (50+ reels/month)
3. Influencer Marketing (500+ creators)
4. Meta Ads / Performance Marketing
5. Brand and Commercial Shoots
6. SEO and Local Growth
7. Website Design

Everything we do is tied to business goals - enquiries, footfall, or sales. Which one interests you?`;

const PROCESS = `How we work:

1. Discovery call - understand your business and goals
2. Custom strategy - tailored content and marketing plan
3. Content production - in-house shoots and edits
4. Publish and amplify - posting, influencers, ads
5. Measure and optimise - monthly reporting

Strategy to content to social media to influencer to Meta Ads. Want to see case studies?`;

const CLIENTS = `We've worked with brands like Audi, Cadbury, Netflix, Samsung, Flipkart, JioMart, Realme, and many local Mumbai businesses - salons, restaurants, jewellers, architects.

Clients have seen 10X more inquiries, 600K+ followers, and 4.5X campaign ROAS.

Want to hear about a specific industry we've worked in?`;

const PACKAGES = `Our packages (starting prices, customised per brand):

Starter - Rs 25,000/mo
2 platforms, 8 reels + posts, monthly calendar, basic report

Growth - Rs 45,000/mo (most popular)
3 platforms, 15 reels + posts, 2-3 influencer collabs, Meta Ads, monthly strategy call

Premium - Rs 85,000/mo
Full service: content + influencers + ads, 25+ reels, brand shoots, dedicated manager

Paid Trial Shoot - one-time
Concept to edited reels, try before committing

All customised after a discovery call. Which one sounds interesting?`;

const FAQ = `Common questions:

What services? Social media, content/reels, influencers, Meta Ads, brand shoots, SEO - all under one roof.

Small businesses? Yes! We work with salons, restaurants, jewellers, and more across Mumbai and Pan-India.

How long for results? Organic growth compounds over months. Paid campaigns show leads within weeks. Monthly reporting.

Trial? Yes - our Paid Trial Shoot lets you experience our quality first.

Based in Mulund West, Mumbai. Serving Pan-India.

Anything else you'd like to know?`;

const CONTACT = `Best way to reach us:
WhatsApp: ${B.whatsappLink}
Phone: ${B.phone}
Email: ${B.email}
Address: ${B.address}

Or fill our enquiry form and we'll come back with a strategy.

Want to book a free discovery call?`;

const HUMAN = `I'll connect you with our team. A member will get back to you shortly.

In the meantime, reach us at:
Phone: ${B.phone}
Email: ${B.email}
WhatsApp: ${B.whatsappLink}`;

const MAIN_MENU = {
  header: `${B.name} • Bot`,
  body: WELCOME,
  footer: 'Tap a service to continue',
  button: 'Choose service',
  sections: [
    {
      title: 'Choose a service',
      rows: [
        { id: 'service_social', title: '1️⃣ Social Media Mgmt', description: 'Social Media Management' },
        { id: 'service_ads', title: '2️⃣ Meta Ads & Leads', description: 'Meta Ads & Lead Generation' },
        { id: 'service_photo', title: '3️⃣ Photo & Video', description: 'Photography & Videography' },
        { id: 'service_website', title: '4️⃣ Website Development', description: 'Website Development' },
        { id: 'service_other', title: '5️⃣ Other Services', description: 'Other Services' },
        { id: 'service_team', title: '6️⃣ Talk to Our Team', description: 'Talk to Our Team' },
      ],
    },
  ],
};

const REPLIES = {
  about: ABOUT,
  services: SERVICES,
  process: PROCESS,
  clients: CLIENTS,
  packages: PACKAGES,
  faq: FAQ,
  contact: CONTACT,
  human: HUMAN,
};

const KEYWORD_MAP = [
  { keys: ['hi', 'hello', 'hey', 'start', 'menu', 'help', 'hii', 'hola', 'namaste'], id: 'menu' },
  { keys: ['about', 'who are you', 'company', 'agency', 'famebros', 'about you', 'tell me about', 'who is'], id: 'about' },
  { keys: ['service', 'what do you do', 'offer', 'reel', 'content', 'social media', 'ads', 'marketing', 'what services', 'do you do', 'what can you', 'capabilities'], id: 'services' },
  { keys: ['package', 'pricing', 'price', 'cost', 'plan', 'retainer', 'trial', 'how much', 'charges', 'fee', 'rates', 'budget'], id: 'packages' },
  { keys: ['process', 'how do you', 'steps', 'workflow', 'how it works', 'how does it work', 'methodology'], id: 'process' },
  { keys: ['client', 'case study', 'portfolio', 'work', 'brand', 'result', 'examples', 'previous work', 'who have you'], id: 'clients' },
  { keys: ['faq', 'question', 'doubt', 'query'], id: 'faq' },
  { keys: ['contact', 'call', 'book', 'phone', 'email', 'reach', 'get in touch', 'connect', 'reach out'], id: 'contact' },
  { keys: ['human', 'agent', 'person', 'team', 'talk', 'speak', 'someone', 'real person', 'live chat', 'representative', 'talk to a human'], id: 'human' },
];

function matchKeyword(text) {
  const t = text.toLowerCase().trim();
  const contextualSingleWords = new Set(['pricing', 'price', 'cost', 'packages', 'workflow']);
  for (const { keys, id } of KEYWORD_MAP) {
    if (keys.some((key) => {
      const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      if (!key.includes(' ') && !contextualSingleWords.has(key)) return t === key;
      return new RegExp(`(?:^|\\b)${escaped}(?:\\b|$)`, 'i').test(t);
    })) return id;
  }
  return null;
}

module.exports = {
  WELCOME, ABOUT, SERVICES, PROCESS, CLIENTS, PACKAGES, FAQ, CONTACT, HUMAN,
  MAIN_MENU, REPLIES, KEYWORD_MAP, matchKeyword,
};

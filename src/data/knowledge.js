const config = require('../config');

const B = config.business;

const WELCOME = `Hi! 👋 Welcome to *${B.name}*.

We're Mumbai's leading social media & content agency — we help businesses grow with strategy, content, influencers & ads.

How can I help you today? Pick an option below.`;

const ABOUT = `*About ${B.name}*

${B.name} is a social media marketing & content production agency based in ${B.address}. We combine strategy, creativity and performance marketing to grow real businesses — not just follower counts.

📊 *By the numbers*
• 50+ businesses managed
• 80% new clients via referrals
• 500+ creators in our network
• 25-person in-house team
• +300% avg organic reach
• 4.5X inbound leads
• 4.5X avg campaign ROAS

*Our mission:* Great businesses deserve to be seen. We give local businesses the content strategy, production quality and marketing systems national brands use.

📍 ${B.address}
📞 ${B.phone}
✉️ ${B.email}`;

const SERVICES = `*Our Services* (all under one roof)

1. Social Media Management & Marketing
2. Content & Reel Production (50+ reels/month)
3. Influencer Marketing (500+ creators)
4. Meta Ads / Performance Marketing
5. Brand & Commercial Shoots
6. SEO & Local Growth
7. Website Design & Development

Every piece of content is tied to a business goal — enquiries, footfall or sales.`;

const PROCESS = `*How We Grow Your Business* (5 steps)

1️⃣ Discovery Call — understand your business, audience & goals
2️⃣ Custom Strategy — tailored content & marketing plan
3️⃣ Content Production — in-house shoots, edits, reels
4️⃣ Publish & Amplify — posting + influencers + ads
5️⃣ Measure & Optimise — monthly reporting & optimisation

Strategy → Content → Social Media → Influencer → Meta Ads`;

const CLIENTS = `*Brands We've Worked With*

Audi, Cadbury, Netflix, Samsung, Flipkart, Meta, JioMart, Realme, Filmfare, Red Chillies Entertainment, Baskin Robbins, Cello Writing, Indian Idol, Laughter Chefs, and many local Mumbai brands (salons, restaurants, jewellers, furniture, architects).

📈 Results clients have seen:
• 10X more inquiries
• 600K+ followers
• 10K followers in 1 month
• 4.5X campaign ROAS`;

const PACKAGES = `*Our Packages* (starting prices, customised per brand)

🟢 *Starter* — from ₹25,000/mo
• Social media management (2 platforms)
• 8 reels + posts/month
• Monthly content calendar
• Basic performance report

🔵 *Growth* — from ₹45,000/mo  ⭐ Most popular
• 3 platforms managed
• 15 reels + posts/month
• Influencer collaborations (2-3/mo)
• Meta Ads management (ad spend separate)
• Monthly strategy call

🟣 *Premium* — from ₹85,000/mo
• Full-service: content + influencers + ads
• 25+ reels/month + brand shoots
• Dedicated account manager
• Advanced analytics & ROAS tracking

🟡 *Paid Trial Shoot* — one-time
• Concept, scripting, direction, edited reels
• Try us before committing to a retainer

All packages are customised after a discovery call. Final pricing depends on scope, platforms & ad spend.`;

const FAQ = `*Frequently Asked Questions*

Q: What services do you offer?
A: Social media management, content/reel production, influencer marketing, Meta Ads, brand shoots, performance marketing — all under one roof.

Q: Do you work with small local businesses?
A: Yes! We work with salons, restaurants, jewellers, furniture stores, architects and more across Mumbai & Pan-India.

Q: How long before results?
A: Organic growth compounds over months; paid campaigns can show leads within weeks. We report monthly with real numbers.

Q: Do you offer a trial?
A: Yes — our Paid Trial Shoot lets you experience our production quality before committing.

Q: Where are you based?
A: Mulund West, Mumbai - 400080. We serve clients Pan-India (Mumbai, Hyderabad, Dubai and more).`;

const CONTACT = `*Let's Grow Your Business* 🚀

The fastest way to reach us:
📱 WhatsApp: ${B.whatsappLink}
📞 ${B.phone}
✉️ ${B.email}
📍 ${B.address}

Or fill our enquiry form on the website and we'll come back with a strategy that works.

Would you like to book a free discovery call?`;

const HUMAN = `I'll connect you with our team shortly. 🙌

In the meantime, you can reach us directly:
📱 WhatsApp: ${B.whatsappLink}
📞 ${B.phone}
✉️ ${B.email}

A team member will get back to you as soon as possible.`;

const MAIN_MENU = {
  header: `${B.name}`,
  body: WELCOME,
  footer: 'Reply with a number or tap an option',
  button: 'Menu',
  sections: [
    {
      title: 'Learn About Us',
      rows: [
        { id: 'about', title: 'About Us', description: 'Who we are & our mission' },
        { id: 'services', title: 'Our Services', description: 'What we do' },
        { id: 'process', title: 'Our Process', description: 'How we grow your business' },
      ],
    },
    {
      title: 'Packages & Proof',
      rows: [
        { id: 'packages', title: 'Packages & Pricing', description: 'Starter / Growth / Premium' },
        { id: 'clients', title: 'Case Studies & Clients', description: 'Brands & results' },
        { id: 'faq', title: 'FAQs', description: 'Common questions' },
      ],
    },
    {
      title: 'Get In Touch',
      rows: [
        { id: 'contact', title: 'Book a Free Call', description: 'Talk to our team' },
        { id: 'human', title: 'Talk to a Human', description: 'Connect with a team member' },
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
  { keys: ['hi', 'hello', 'hey', 'start', 'menu', 'help'], id: 'menu' },
  { keys: ['about', 'who are you', 'company', 'agency', 'famebros'], id: 'about' },
  { keys: ['service', 'what do you do', 'offer', 'reel', 'content', 'social media', 'ads', 'marketing'], id: 'services' },
  { keys: ['package', 'pricing', 'price', 'cost', 'plan', 'retainer', 'trial shoot', 'trial'], id: 'packages' },
  { keys: ['process', 'how do you', 'steps', 'workflow'], id: 'process' },
  { keys: ['client', 'case study', 'portfolio', 'work', 'brand', 'result'], id: 'clients' },
  { keys: ['faq', 'question'], id: 'faq' },
  { keys: ['contact', 'call', 'book', 'phone', 'email', 'reach'], id: 'contact' },
  { keys: ['human', 'agent', 'person', 'team', 'talk to'], id: 'human' },
];

function matchKeyword(text) {
  const t = text.toLowerCase();
  for (const { keys, id } of KEYWORD_MAP) {
    if (keys.some((k) => t.includes(k))) return id;
  }
  return null;
}

module.exports = {
  WELCOME, ABOUT, SERVICES, PROCESS, CLIENTS, PACKAGES, FAQ, CONTACT, HUMAN,
  MAIN_MENU, REPLIES, KEYWORD_MAP, matchKeyword,
};
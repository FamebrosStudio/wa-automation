const leads = require('./leads');

const FLOW_STEPS = {
  name: { question: "What's your name?", next: 'business', field: 'name' },
  business: { question: "What's your business name or type? (e.g., salon, restaurant, e-commerce)", next: 'budget', field: 'business' },
  budget: { question: "What's your monthly marketing budget range?", options: ['Under 25K', '25K-50K', '50K-1L', '1L+'], next: 'timeline', field: 'budget' },
  timeline: { question: "When do you want to start?", options: ['Immediately', 'This month', 'Next month', 'Just exploring'], next: null, field: 'timeline' },
};

const activeFlows = new Map();

const SERVICE_FLOWS = {
  social: {
    service: 'Social Media Management',
    intro: 'Great choice! 🚀\n\nAt Famebros Studio, we provide complete Social Media Management, including content planning, professional shoots, reels, creatives, captions and account management.\n\nPlease tap the option below to continue.',
    steps: {
      businessOwner: { question: 'Are you a business owner or creator?', options: ['I own a business', "I'm a creator/influencer", "I'm starting a new business"], field: 'businessOwner', next: 'clientName' },
      clientName: { question: 'What is your name?', field: 'clientName', next: 'category' },
      category: { question: 'Which category best describes your business?', options: ['Food & Beverage', 'Fashion & Beauty', 'Health & Fitness', 'Home & Real Estate', 'Retail & E-commerce', 'Education', 'Professional Services', 'Other'], field: 'category', next: 'instagram' },
      instagram: { question: 'Please share your Instagram profile link. Example: https://www.instagram.com/yourbrand/ (Please send the full link, not just a username.)', field: 'instagram', doneReply: 'Thank you! 😊\n\nWe\'ve received your business details and requirements.\n\nOur team will review everything and connect with you to discuss a suitable social media strategy and package.\n\n*Famebros Studio* 🚀' },
    },
  },
  ads: {
    service: 'Meta Ads & Lead Generation',
    intro: 'Looking to generate more leads and customers through Meta Ads? 📈\n\nWe can help you run targeted Facebook and Instagram advertising campaigns.\n\nFirst, what is your name?',
    steps: {
      clientName: { question: 'What is your name?', field: 'clientName', next: 'businessName' },
      businessName: { question: 'What is your business name?', field: 'businessName', next: 'location' },
      location: { question: 'What is your Business Location?', field: 'location', next: 'product' },
      product: { question: 'What Product or Service do you offer?', field: 'product', next: 'instagram' },
      instagram: { question: 'Please share your Instagram Page Link (or type “none”).', field: 'instagram', next: 'goal' },
      goal: { question: 'What is your main advertising goal?', options: ['WhatsApp Enquiries', 'Lead Form Enquiries', 'Website Sales', 'Store Visits', 'Brand Awareness'], field: 'goal', doneReply: 'Thank you! ✅ We\'ve received your advertising requirements. Our sales team will review them and get in touch shortly.' },
    },
  },
  photo: {
    service: 'Photography & Videography',
    intro: 'Let\'s create something amazing! 🎥\n\nWhat type of shoot do you need?',
    steps: {
      shootType: { question: 'What type of shoot do you need?', options: ['Product Shoot', 'Restaurant/Food Shoot', 'Fashion/Model Shoot', 'Brand Promotional Reel', 'Event Coverage', 'Other Shoot'], field: 'shootType', next: 'clientName' },
      clientName: { question: 'What is your name?', field: 'clientName', doneReply: 'Thank you! ✅\n\nOur production team will review your requirements and connect with you regarding shoot planning and pricing.' },
    },
  },
  website: {
    service: 'Website Development',
    intro: 'Let\'s build your online presence! 🌐\n\nWhat type of website are you looking for?',
    steps: {
      websiteType: { question: 'What type of website are you looking for?', options: ['Business Website', 'E-commerce Website', 'Portfolio Website', 'Landing Page', 'Website Redesign', 'Need Guidance'], field: 'websiteType', next: 'clientName' },
      clientName: { question: 'What is your name?', field: 'clientName', next: 'currentWebsite' },
      currentWebsite: { question: 'Please share your current website link, or type “none” if you do not have one.', field: 'currentWebsite', doneReply: 'Thank you! ✅ We\'ve received your website requirements. Our website team will review them and get in touch shortly.' },
    },
  },
  other: {
    service: 'Other Services',
    intro: 'Happy to help with other services. 🎯\n\nPlease share what you need.',
    steps: {
      requirement: { question: 'What service or support do you need?', field: 'requirement', next: 'name' },
      name: { question: 'What is your name?', field: 'name', next: 'business' },
      business: { question: 'What is your business name or type?', field: 'business', next: 'location' },
      location: { question: 'Where is your business located?', field: 'location', next: 'budget' },
      budget: { question: 'What is your budget range?', options: ['Under 25K', '25K-50K', '50K-1L', '1L+', 'Not sure'], field: 'budget', next: 'timeline' },
      timeline: { question: 'When would you like to start?', options: ['Immediately', 'This month', 'Next month', 'Just exploring'], field: 'timeline', doneReply: 'Thank you! ✅ We have received your requirements. Our team will connect with you shortly.' },
    },
  },
  team: {
    service: 'Talk to Our Team',
    intro: 'Of course! 😊\n\nWe\'re connecting you with our team.\n\nPlease share your name.',
    steps: {
      name: { question: 'Please share your name.', field: 'name', next: 'requirement' },
      requirement: { question: 'What would you like help with?', field: 'requirement', doneReply: 'Thank you! 😊 We\'ve received your details. Our team will be in touch to assist you.' },
    },
  },
};

function startFlow(phone) {
  activeFlows.set(phone, { step: 'name', data: {}, history: [] });
  return FLOW_STEPS.name.question;
}

function startServiceFlow(phone, serviceKey) {
  const definition = SERVICE_FLOWS[serviceKey];
  if (!definition) return null;
  const firstStep = Object.keys(definition.steps)[0];
  activeFlows.set(phone, { service: serviceKey, step: firstStep, data: {}, history: [] });
  return { intro: definition.intro, step: firstStep, ...definition.steps[firstStep] };
}

function getOptionId(step, option) {
  return `flow_${step}_${String(option).toLowerCase().replace(/[^a-z0-9]+/g, '_')}`;
}

function normalizeInstagramProfileUrl(value) {
  const input = (value || '').trim();
  if (!input || input.length > 500) return null;
  let url;
  try {
    url = new URL(/^https?:\/\//i.test(input) ? input : `https://${input}`);
  } catch (_) {
    return null;
  }
  if (!['http:', 'https:'].includes(url.protocol)) return null;
  if (!['instagram.com', 'www.instagram.com'].includes(url.hostname.toLowerCase())) return null;
  const parts = url.pathname.split('/').filter(Boolean);
  if (parts.length !== 1) return null;
  const username = parts[0];
  const reserved = new Set(['accounts', 'about', 'developer', 'direct', 'explore', 'legal', 'p', 'reel', 'reels', 'stories', 'web']);
  if (!/^[a-zA-Z0-9._]{1,30}$/.test(username) || reserved.has(username.toLowerCase())) return null;
  return `https://www.instagram.com/${username}/`;
}

function hasActiveFlow(phone) {
  return activeFlows.has(phone);
}

function getCurrentStep(phone) {
  const flow = activeFlows.get(phone);
  if (!flow) return null;
  if (flow.service) return { step: flow.step, service: flow.service, ...SERVICE_FLOWS[flow.service].steps[flow.step] };
  return { step: flow.step, ...FLOW_STEPS[flow.step] };
}

function processFlowResponse(phone, text) {
  const flow = activeFlows.get(phone);
  if (!flow) return null;

  const normalized = (text || '').trim();
  if (/^(cancel|stop|menu)$/i.test(normalized)) {
    cancelFlow(phone);
    return { reply: 'No problem, I have cancelled that. You can keep asking me anything, or type menu to see the options.', options: null, done: false, cancelled: true };
  }
  if (/^(back|go back)$/i.test(normalized)) {
    if (Array.isArray(flow.history) && flow.history.length) {
      flow.step = flow.history.pop();
      const current = getCurrentStep(phone);
      if (current) return { reply: current.question, options: current.options || null, step: flow.step, done: false, back: true };
    }
    const current = getCurrentStep(phone);
    return { reply: 'You are already at the first step.', options: current?.options || null, step: flow.step, done: false };
  }
  if (/^(restart|start over)$/i.test(normalized)) {
    const service = flow.service;
    if (service) return startServiceFlow(phone, service);
    return startFlow(phone);
  }

  const flowDefinition = flow.service ? SERVICE_FLOWS[flow.service] : null;
  const stepConfig = flowDefinition ? flowDefinition.steps[flow.step] : FLOW_STEPS[flow.step];
  if (!stepConfig) return null;
  const selectedIndex = /^flow_([a-z0-9]+)_(\d+)$/i.exec(normalized);
  if (selectedIndex && (!stepConfig.options || selectedIndex[1].toLowerCase() !== flow.step.toLowerCase())) {
    return { reply: stepConfig.question, options: stepConfig.options || null, step: flow.step, done: false, staleOption: true };
  }
  let answer = selectedIndex
    ? stepConfig.options[Number(selectedIndex[2])]
    : stepConfig.options && /^\d+$/.test(normalized)
      ? stepConfig.options[Number(normalized) - 1]
      : normalized;

  if (flowDefinition && stepConfig.field === 'instagram' && answer.toLowerCase() !== 'none') {
    answer = normalizeInstagramProfileUrl(answer);
    if (!answer) {
      return {
        reply: 'That does not look like a valid Instagram profile link. Please send the full profile URL, for example: https://www.instagram.com/yourbrand/',
        options: null,
        step: flow.step,
        done: false,
        invalid: true,
      };
    }
  }

  if (stepConfig.options && !stepConfig.options.includes(answer)) {
    return { reply: stepConfig.question, options: stepConfig.options, step: flow.step, done: false };
  }
  flow.history = flow.history || [];
  flow.history.push(flow.step);
  flow.data[stepConfig.field] = answer;

  if (flowDefinition) {
    const lead = leads.getLead(phone);
    const updates = { serviceDetails: { ...(lead.serviceDetails || {}), ...flow.data } };
    if (stepConfig.field === 'clientName' || stepConfig.field === 'name') updates.name = answer;
    if (stepConfig.field === 'businessName' || stepConfig.field === 'business') updates.business = answer;
    if (stepConfig.field === 'category') updates.category = answer;
    if (stepConfig.field === 'instagram') updates.instagram = answer;
    leads.updateLead(phone, updates);
  }

  if (flowDefinition) {
    if (stepConfig.next) {
      flow.step = stepConfig.next;
      const next = flowDefinition.steps[flow.step];
      return { reply: next.question, options: next.options || null, step: flow.step, done: false };
    }
    const data = { ...flow.data };
    activeFlows.delete(phone);
    const lead = leads.getLead(phone);
    leads.updateLead(phone, {
      service: flowDefinition.service,
      humanRequested: flow.service === 'team',
      business: data.businessName || data.business || lead.business,
      name: data.clientName || data.name || lead.name,
      budget: data.budget || lead.budget,
      timeline: data.timeline || lead.timeline,
      instagram: data.instagram || lead.instagram,
      category: data.category || lead.category,
      location: data.location || lead.location,
      product: data.product || lead.product,
      goal: data.goal || lead.goal,
      shootType: data.shootType || lead.shootType,
      websiteType: data.websiteType || lead.websiteType,
      currentWebsite: data.currentWebsite || lead.currentWebsite,
      requirement: data.requirement || lead.requirement,
      serviceDetails: data,
      conversationStatus: 'COMPLETED',
      completionMessageSent: false,
    });
    return { reply: stepConfig.doneReply, options: null, done: true, data, service: flowDefinition.service };
  }

  if (stepConfig.next) {
    flow.step = stepConfig.next;
    const nextConfig = FLOW_STEPS[stepConfig.next];
    if (nextConfig.options) return { reply: nextConfig.question, options: nextConfig.options, step: stepConfig.next, done: false };
    return { reply: nextConfig.question, options: null, done: false };
  }

  const data = flow.data;
  activeFlows.delete(phone);
  const lead = leads.getLead(phone);
  if (data.name) lead.name = data.name;
  if (data.business) lead.business = data.business;
  if (data.budget) lead.budget = data.budget;
  if (data.timeline) lead.timeline = data.timeline;
  lead.conversationStatus = 'COMPLETED';
  lead.completionMessageSent = false;
  return { reply: `Thanks ${data.name || ''}! I have your details. Our team will review them and get back to you.`, options: null, done: true, data };
}

function cancelFlow(phone) {
  activeFlows.delete(phone);
}

function restoreFlow(phone, state) {
  // Existing persisted social flows used the old identity -> Instagram path.
  // Route them through the new required details rather than dropping the flow.
  if (state?.service === 'social' && !state.data?.clientName) {
    state = { ...state, step: 'clientName', data: { ...(state.data || {}) } };
  }
  // Older website flows asked for a business name here. Resume them at the
  // client-name question without copying business data into the person's name.
  if (state?.service === 'website' && state.step === 'businessName') {
    state = { ...state, step: 'clientName', data: { ...(state.data || {}) } };
  }
  // Resume existing ads and photography flows at the newly required identity step.
  if (state?.service === 'ads' && state.step !== 'clientName' && !state.data?.clientName) {
    state = { ...state, step: 'clientName', data: { ...(state.data || {}) } };
  }
  if (state?.service === 'photo' && state.step !== 'clientName' && !state.data?.clientName) {
    state = { ...state, step: 'clientName', data: { ...(state.data || {}) } };
  }
  const validStep = state?.service
    ? SERVICE_FLOWS[state.service]?.steps[state.step]
    : FLOW_STEPS[state?.step];
  if (state && validStep && state.data && typeof state.data === 'object') {
    activeFlows.set(phone, { step: state.step, data: { ...state.data }, service: state.service, history: Array.isArray(state.history) ? state.history : [] });
  } else {
    activeFlows.delete(phone);
  }
}

function snapshotFlow(phone) {
  const state = activeFlows.get(phone);
  return state ? { step: state.step, data: { ...state.data }, service: state.service, history: [...(state.history || [])] } : null;
}

module.exports = { startFlow, startServiceFlow, hasActiveFlow, getCurrentStep, getOptionId, processFlowResponse, cancelFlow, restoreFlow, snapshotFlow, normalizeInstagramProfileUrl, FLOW_STEPS, SERVICE_FLOWS };

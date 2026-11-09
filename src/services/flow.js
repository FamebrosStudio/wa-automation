const leads = require('./leads');

// Multi-step lead capture flow
// Steps: name -> business -> budget -> timeline -> done
const FLOW_STEPS = {
  name: {
    question: "What's your name?",
    next: 'business',
    field: 'name',
  },
  business: {
    question: "What's your business name or type? (e.g., salon, restaurant, e-commerce)",
    next: 'budget',
    field: 'business',
  },
  budget: {
    question: "What's your monthly marketing budget range?",
    options: ['Under 25K', '25K-50K', '50K-1L', '1L+'],
    next: 'timeline',
    field: 'budget',
  },
  timeline: {
    question: "When do you want to start?",
    options: ['Immediately', 'This month', 'Next month', 'Just exploring'],
    next: null,
    field: 'timeline',
  },
};

const activeFlows = new Map(); // phone -> { step, data }

const SERVICE_FLOWS = {
  social: {
    service: 'Social Media Management', team: 'Social Media Team',
    intro: 'Great choice! 🚀\n\nAt Famebros Studio, we provide complete Social Media Management, including content planning, professional shoots, reels, creatives, captions and account management.\n\nTo understand your business better, please select:',
    steps: {
      identity: { question: 'Choose the option that best describes you:', options: ['I own a business', "I'm a creator/influencer", "I'm starting a new business"], field: 'customerType', next: 'instagram' },
      instagram: { question: 'Perfect! 😊\n\nPlease share your Instagram Page Link.', field: 'instagram', doneReply: 'Thank you! 😊\n\nWe\'ve received your business details and requirements.\n\nOur team will review everything and connect with you to discuss a suitable social media strategy and package.\n\n*Famebros Studio* 🚀' },
    },
  },
  ads: {
    service: 'Meta Ads & Lead Generation', team: 'Sales Team',
    intro: 'Looking to generate more leads and customers through Meta Ads? 📈\n\nWe can help you run targeted Facebook and Instagram advertising campaigns.\n\nPlease share your Business Name.',
    steps: {
      businessName: { question: 'Please share your Business Name.', field: 'businessName', next: 'location' },
      location: { question: 'What is your Business Location?', field: 'location', next: 'product' },
      product: { question: 'What Product or Service do you offer?', field: 'product', next: 'instagram' },
      instagram: { question: 'Please share your Instagram Page Link (or type “none”).', field: 'instagram', next: 'goal' },
      goal: { question: 'What is your main advertising goal?', options: ['WhatsApp Enquiries', 'Lead Form Enquiries', 'Website Sales', 'Store Visits', 'Brand Awareness'], field: 'goal', doneReply: 'Thank you! ✅ We\'ve received your advertising requirements. Our sales team will review them and get in touch shortly.' },
    },
  },
  photo: {
    service: 'Photography & Videography', team: 'Production Team',
    intro: 'Let\'s create something amazing! 🎥\n\nWhat type of shoot do you need?',
    steps: {
      shootType: { question: 'What type of shoot do you need?', options: ['Product Shoot', 'Restaurant/Food Shoot', 'Fashion/Model Shoot', 'Brand Promotional Reel', 'Event Coverage', 'Other Shoot'], field: 'shootType', doneReply: 'Thank you! ✅\n\nOur production team will review your requirements and connect with you regarding shoot planning and pricing.' },
    },
  },
  website: {
    service: 'Website Development', team: 'Website Team',
    intro: 'Let\'s build your online presence! 🌐\n\nWhat type of website are you looking for?',
    steps: {
      websiteType: { question: 'What type of website are you looking for?', options: ['Business Website', 'E-commerce Website', 'Portfolio Website', 'Landing Page', 'Website Redesign', 'Need Guidance'], field: 'websiteType', next: 'businessName' },
      businessName: { question: 'What is your Business Name?', field: 'businessName', next: 'currentWebsite' },
      currentWebsite: { question: 'Please share your current website link, or type “none” if you do not have one.', field: 'currentWebsite', doneReply: 'Thank you! ✅ We\'ve received your website requirements. Our website team will review them and get in touch shortly.' },
    },
  },
  team: {
    service: 'Talk to Our Team', team: 'Sales Team',
    intro: 'Of course! 😊\n\nWe\'re connecting you with our team.\n\nPlease share your name.',
    steps: {
      name: { question: 'Please share your name.', field: 'name', next: 'requirement' },
      requirement: { question: 'What would you like help with?', field: 'requirement', doneReply: 'Thank you! 😊 We\'ve received your details. Our team will be in touch to assist you.' },
    },
  },
};

function startFlow(phone) {
  activeFlows.set(phone, { step: 'name', data: {} });
  return FLOW_STEPS.name.question;
}

function startServiceFlow(phone, serviceKey) {
  const definition = SERVICE_FLOWS[serviceKey];
  if (!definition) return null;
  const firstStep = Object.keys(definition.steps)[0];
  activeFlows.set(phone, { service: serviceKey, step: firstStep, data: {} });
  return { intro: definition.intro, step: firstStep, ...definition.steps[firstStep] };
}

function getOptionId(step, option) {
  return `flow_${step}_${FLOW_STEPS[step].options.indexOf(option)}`;
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

  if (/^(cancel|stop|menu)$/i.test((text || '').trim())) {
    cancelFlow(phone);
    return { reply: 'No problem, I have cancelled that. You can keep asking me anything, or type menu to see the options.', options: null, done: false, cancelled: true };
  }

  const flowDefinition = flow.service ? SERVICE_FLOWS[flow.service] : null;
  const stepConfig = flowDefinition ? flowDefinition.steps[flow.step] : FLOW_STEPS[flow.step];
  const selectedIndex = /^flow_[a-z0-9]+_(\d+)$/i.exec((text || '').trim());
  const answer = selectedIndex && selectedIndex[1] === flow.step
    ? stepConfig.options[Number(selectedIndex[1])]
    : selectedIndex && stepConfig.options
      ? stepConfig.options[Number(selectedIndex[1])]
      : stepConfig.options && /^\d+$/.test((text || '').trim())
        ? stepConfig.options[Number(text.trim()) - 1]
    : text;
  if (stepConfig.options && !stepConfig.options.includes(answer)) {
    return { reply: stepConfig.question, options: stepConfig.options, step: flow.step, done: false };
  }
  flow.data[stepConfig.field] = answer;

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
      assignedTeam: flowDefinition.team,
      status: leads.STATUS.QUALIFIED,
      humanRequested: flow.service === 'team',
      business: data.businessName || lead.business,
      name: data.name || lead.name,
      serviceDetails: data,
    });
    return { reply: stepConfig.doneReply, options: null, done: true, data, service: flowDefinition.service, team: flowDefinition.team };
  }

  if (stepConfig.next) {
    flow.step = stepConfig.next;
    const nextConfig = FLOW_STEPS[stepConfig.next];
    if (nextConfig.options) {
      return { reply: nextConfig.question, options: nextConfig.options, step: stepConfig.next, done: false };
    }
    return { reply: nextConfig.question, options: null, done: false };
  }

  // Flow complete
  const data = flow.data;
  activeFlows.delete(phone);

  // Update lead with collected data
  const lead = leads.getLead(phone);
  if (data.name) lead.name = data.name;
  if (data.business) lead.business = data.business;
  if (data.budget) lead.budget = data.budget;
  if (data.timeline) lead.timeline = data.timeline;

  return {
    reply: `Thanks ${data.name || ''}! I have your details. Our team will review them and get back to you. You can also keep asking me questions here.`,
    options: null,
    done: true,
    data,
  };
}

function cancelFlow(phone) {
  activeFlows.delete(phone);
}

function restoreFlow(phone, state) {
  const validStep = state?.service
    ? SERVICE_FLOWS[state.service]?.steps[state.step]
    : FLOW_STEPS[state?.step];
  if (state && validStep && state.data && typeof state.data === 'object') activeFlows.set(phone, state);
  else activeFlows.delete(phone);
}

function snapshotFlow(phone) {
  const state = activeFlows.get(phone);
  return state ? { step: state.step, data: { ...state.data } } : null;
}

module.exports = { startFlow, startServiceFlow, hasActiveFlow, getCurrentStep, getOptionId, processFlowResponse, cancelFlow, restoreFlow, snapshotFlow, FLOW_STEPS, SERVICE_FLOWS };

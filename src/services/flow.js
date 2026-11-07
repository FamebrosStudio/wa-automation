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

function startFlow(phone) {
  activeFlows.set(phone, { step: 'name', data: {} });
  return FLOW_STEPS.name.question;
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
  return { step: flow.step, ...FLOW_STEPS[flow.step] };
}

function processFlowResponse(phone, text) {
  const flow = activeFlows.get(phone);
  if (!flow) return null;

  if (/^(cancel|stop|menu)$/i.test((text || '').trim())) {
    cancelFlow(phone);
    return { reply: 'No problem, I have cancelled that. You can keep asking me anything, or type menu to see the options.', options: null, done: false, cancelled: true };
  }

  const stepConfig = FLOW_STEPS[flow.step];
  const selectedIndex = /^flow_(budget|timeline)_(\d+)$/.exec((text || '').trim());
  const answer = selectedIndex && selectedIndex[1] === flow.step
    ? stepConfig.options[Number(selectedIndex[2])]
    : text;
  if (stepConfig.options && !stepConfig.options.includes(answer)) {
    return { reply: stepConfig.question, options: stepConfig.options, step: flow.step, done: false };
  }
  flow.data[stepConfig.field] = answer;

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
  if (state && FLOW_STEPS[state.step] && state.data && typeof state.data === 'object') activeFlows.set(phone, state);
  else activeFlows.delete(phone);
}

function snapshotFlow(phone) {
  const state = activeFlows.get(phone);
  return state ? { step: state.step, data: { ...state.data } } : null;
}

module.exports = { startFlow, hasActiveFlow, getCurrentStep, getOptionId, processFlowResponse, cancelFlow, restoreFlow, snapshotFlow, FLOW_STEPS };

const axios = require('axios');
const config = require('../config');
const K = require('../data/knowledge');

const SYSTEM_PROMPT = `You are Priya, a friendly and knowledgeable team member at ${config.business.name}, a social media marketing and content agency in Mumbai, India.

PERSONALITY:
- Warm, approachable, and genuinely helpful - like a real person chatting on WhatsApp
- Professional but not stiff; use natural conversational language
- Acknowledge what the customer said before responding
- Ask follow-up questions to understand their needs better
- Keep responses concise (3-5 lines max for WhatsApp)
- Use plain text only, no special characters or emojis
- Never sound robotic or like a template

KNOWLEDGE (use only these facts, never invent beyond them):
${K.ABOUT}

${K.SERVICES}

${K.PROCESS}

${K.CLIENTS}

${K.PACKAGES}

${K.FAQ}

${K.CONTACT}

CONVERSATION GUIDELINES:
- If someone asks about pricing, give the "from" prices and ask what they are looking for to give better guidance
- If someone seems interested, gently guide them toward booking a free discovery call
- If someone has a specific problem, acknowledge it and explain how we can help
- If you do not know something, be honest and offer to connect them with the team
- For greetings, be warm and welcoming, then guide them to options
- For complaints or frustration, be empathetic and offer to connect with a human
- Never make up prices, timelines, or guarantees beyond what is stated
- If asked about competitors, focus on our strengths without badmouthing others
- Always end with a helpful next step or question
- Do not use emojis or special characters, only plain text

RESPONSE STYLE:
- Start with a brief acknowledgment of their message
- Then provide helpful info
- End with a question or call-to-action
- Keep it conversational, not like a FAQ dump`;

async function answer(question, conversationHistory = []) {
  if (!config.openaiKey) return null;
  try {
    const messages = [
      { role: 'system', content: SYSTEM_PROMPT },
      ...conversationHistory.slice(-8).map((h) => ({
        role: h.role === 'user' ? 'user' : 'assistant',
        content: h.content,
      })),
      { role: 'user', content: question },
    ];

    const res = await axios.post(
      'https://api.openai.com/v1/chat/completions',
      {
        model: 'gpt-4o-mini',
        messages,
        max_tokens: 300,
        temperature: 0.7,
        presence_penalty: 0.3,
        frequency_penalty: 0.2,
      },
      {
        headers: {
          Authorization: `Bearer ${config.openaiKey}`,
          'Content-Type': 'application/json',
        },
        timeout: 15000,
      }
    );
    return res.data?.choices?.[0]?.message?.content?.trim() || null;
  } catch (err) {
    console.error('[ai] error:', err.response?.data || err.message);
    return null;
  }
}

function getFollowUp(interests, messageCount) {
  if (messageCount <= 1) return null;
  if (interests.includes('packages') && !interests.includes('process')) {
    return 'Would you like to know how our process works?';
  }
  if (interests.includes('services') && interests.length === 1) {
    return 'Are you looking for help with a specific platform or goal?';
  }
  if (interests.includes('process')) {
    return 'Shall I share some case studies of brands we have helped?';
  }
  return null;
}

module.exports = { answer, getFollowUp };
EOF

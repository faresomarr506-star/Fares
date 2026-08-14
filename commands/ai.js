const axios = require('axios');

function getMessageText(message) {
  return (
    message.message?.conversation ||
    message.message?.extendedTextMessage?.text ||
    message.message?.imageMessage?.caption ||
    message.message?.videoMessage?.caption ||
    ''
  ).trim();
}

function buildArabicPrompt(question, mode = 'ai') {
  const role = mode === 'gemini' ? 'Gemini' : mode === 'gpt' ? 'GPT' : 'AI';
  return [
    `أنت مساعد ${role} مفيد داخل واتساب.`,
    'أجب باللغة العربية فقط.',
    'قدّم إجابة واضحة ومباشرة ومنظمة.',
    'إذا كان السؤال برمجياً فأعطِ حلاً صحيحاً ومختصراً مع أمثلة عند الحاجة.',
    `السؤال: ${question}`
  ].join('\n');
}

function normalizeText(value) {
  return String(value || '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/\r/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function extractAnswer(payload) {
  if (!payload) return '';
  if (typeof payload === 'string') return normalizeText(payload);
  if (Array.isArray(payload)) {
    const joined = payload
      .map(item => (typeof item === 'string' ? item : item?.text || item?.content || item?.message || ''))
      .filter(Boolean)
      .join('\n');
    return normalizeText(joined);
  }

  const directCandidates = [
    payload.result,
    payload.answer,
    payload.message,
    payload.response,
    payload.text,
    payload.data?.result,
    payload.data?.answer,
    payload.data?.message,
    payload.data?.response,
    payload.data?.text,
    payload.data?.content,
    payload.content,
    payload.candidates?.[0]?.content?.parts?.map?.(part => part?.text || '').join('\n'),
    payload.output?.[0]?.content?.[0]?.text
  ];

  for (const candidate of directCandidates) {
    const text = extractAnswer(candidate);
    if (text) return text;
  }

  if (payload.data && typeof payload.data === 'object' && !Array.isArray(payload.data)) {
    for (const value of Object.values(payload.data)) {
      const text = extractAnswer(value);
      if (text) return text;
    }
  }

  for (const value of Object.values(payload)) {
    const text = extractAnswer(value);
    if (text) return text;
  }

  return '';
}

function getCommandAndQuery(text) {
  const parts = String(text || '').trim().split(/\s+/);
  const command = (parts.shift() || '').toLowerCase();
  const query = parts.join(' ').trim();
  return { command, query };
}

async function queryAiApis(question, mode) {
  const prompt = buildArabicPrompt(question, mode);
  const endpoints = [
    `https://zellapi.autos/ai/chatbot?text=${encodeURIComponent(prompt)}`,
    `https://api.ryzendesu.vip/api/ai/gemini?text=${encodeURIComponent(prompt)}`,
    `https://api.siputzx.my.id/api/ai/gemini-pro?content=${encodeURIComponent(prompt)}`,
    `https://api.giftedtech.my.id/api/ai/geminiai?apikey=gifted&q=${encodeURIComponent(prompt)}`
  ];

  let lastError = null;

  for (const endpoint of endpoints) {
    try {
      const response = await axios.get(endpoint, {
        timeout: 25000,
        validateStatus: status => status >= 200 && status < 500,
        headers: {
          'User-Agent': 'Mozilla/5.0'
        }
      });

      const answer = extractAnswer(response.data);
      if (answer) return answer;
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError || new Error('All AI endpoints failed');
}

async function aiCommand(sock, chatId, message) {
  try {
    const text = getMessageText(message);
    const { command, query } = getCommandAndQuery(text);
    const mode = command === '.gemini' ? 'gemini' : command === '.gpt' ? 'gpt' : 'ai';

    if (!query) {
      return await sock.sendMessage(chatId, {
        text: 'اكتب سؤالك بعد الأمر مباشرة.\n\nأمثلة:\n.ai اشرح لي async await\n.gpt اكتب كود تسجيل دخول بسيط\n.gemini لخص هذا الموضوع'
      }, { quoted: message });
    }

    await sock.sendMessage(chatId, {
      react: { text: '🤖', key: message.key }
    });

    const answer = await queryAiApis(query, mode);

    await sock.sendMessage(chatId, {
      text: answer || '❌ لم أتمكن من استخراج رد مناسب الآن، جرّب مرة أخرى.'
    }, { quoted: message });
  } catch (error) {
    console.error('AI Command Error:', error);
    await sock.sendMessage(chatId, {
      text: '❌ تعذر الحصول على رد من الذكاء الاصطناعي حالياً. حاول مرة ثانية بعد قليل.'
    }, { quoted: message });
  }
}

module.exports = aiCommand;

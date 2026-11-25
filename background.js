// Moodle AI Demo - Background Service Worker
// For academic integrity research demonstration only

const OLLAMA_URL = 'http://localhost:11434/api/generate';
const DEFAULT_MODEL = 'llama3.2:3b';

// Listen for messages from content script
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'analyzeQuestions') {
    handleAnalyzeQuestions(request.questions)
      .then(sendResponse)
      .catch(error => sendResponse({ error: error.message }));
    return true; // Required for async sendResponse
  }
});

async function handleAnalyzeQuestions(questions) {
  // Get selected model from storage
  const storage = await chrome.storage.local.get(['selectedModel']);
  const model = storage.selectedModel || DEFAULT_MODEL;

  const answers = [];

  for (const question of questions) {
    try {
      const answer = await analyzeQuestion(question, model);
      answers.push(answer);
    } catch (error) {
      answers.push({
        answer: 'Error analyzing question',
        confidence: 'low',
        explanation: error.message
      });
    }
  }

  return { answers };
}

async function analyzeQuestion(question, model) {
  // Build prompt based on question type
  let prompt = buildPrompt(question);

  try {
    const response = await fetch(OLLAMA_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: model,
        prompt: prompt,
        stream: false,
        options: {
          temperature: 0.1, // Low temperature for more deterministic answers
          num_predict: 200  // Limit response length
        }
      })
    });

    if (!response.ok) {
      throw new Error(`Ollama error: ${response.status}`);
    }

    const data = await response.json();
    return parseAIResponse(data.response, question);

  } catch (error) {
    if (error.message.includes('Failed to fetch')) {
      throw new Error('Cannot connect to Ollama. Make sure it is running (ollama serve)');
    }
    throw error;
  }
}

function buildPrompt(question) {
  if (question.type === 'multiple_choice' && question.options.length > 0) {
    return `You are answering a multiple choice question. Analyze the question and select the BEST answer.

Question: ${question.text}

Options:
${question.options.map((opt, i) => `${String.fromCharCode(65 + i)}. ${opt}`).join('\n')}

Respond in this EXACT format:
ANSWER: [letter]
CONFIDENCE: [high/medium/low]
EXPLANATION: [brief 1-sentence reason]

Only respond with the format above, nothing else.`;
  }

  if (question.type === 'multiple_answer') {
    return `You are answering a multiple answer question where more than one option may be correct.

Question: ${question.text}

Options:
${question.options.map((opt, i) => `${String.fromCharCode(65 + i)}. ${opt}`).join('\n')}

Respond in this EXACT format:
ANSWER: [letters separated by commas, e.g., A, C, D]
CONFIDENCE: [high/medium/low]
EXPLANATION: [brief 1-sentence reason]`;
  }

  if (question.type === 'short_answer') {
    return `Answer this question briefly and directly:

Question: ${question.text}

Respond in this EXACT format:
ANSWER: [your short answer]
CONFIDENCE: [high/medium/low]
EXPLANATION: [brief reason]`;
  }

  // Default/essay type
  return `Answer this question:

Question: ${question.text}

Provide a concise, accurate answer.`;
}

function parseAIResponse(response, question) {
  const result = {
    answer: '',
    confidence: 'medium',
    explanation: '',
    answerIndex: -1
  };

  // Extract answer
  const answerMatch = response.match(/ANSWER:\s*([^\n]+)/i);
  if (answerMatch) {
    result.answer = answerMatch[1].trim();

    // For multiple choice, extract the letter and find the index
    const letterMatch = result.answer.match(/^([A-Z])/i);
    if (letterMatch && question.options.length > 0) {
      const letter = letterMatch[1].toUpperCase();
      result.answerIndex = letter.charCodeAt(0) - 65;

      // Include the option text in the answer
      if (result.answerIndex >= 0 && result.answerIndex < question.options.length) {
        result.answer = `${letter}. ${question.options[result.answerIndex]}`;
      }
    }
  } else {
    // Try to extract any meaningful answer
    result.answer = response.split('\n')[0].substring(0, 200);
  }

  // Extract confidence
  const confidenceMatch = response.match(/CONFIDENCE:\s*(high|medium|low)/i);
  if (confidenceMatch) {
    result.confidence = confidenceMatch[1].toLowerCase();
  }

  // Extract explanation
  const explanationMatch = response.match(/EXPLANATION:\s*([^\n]+)/i);
  if (explanationMatch) {
    result.explanation = explanationMatch[1].trim();
  }

  return result;
}

// ---------- Page Assistant ----------
// The content script opens a port named "page-assistant" and sends one request:
// { instruction, pageText, pageTitle, pageUrl }. We stream Ollama's reply back
// as { chunk } messages, then { done } or { error }.

const OLLAMA_CHAT_URL = 'http://localhost:11434/api/chat';
const ASSISTANT_TIMEOUT_MS = 5 * 60 * 1000;
const ASSISTANT_SYSTEM_PROMPT =
  'You are a helpful coding and study assistant running inside the user\'s web browser. ' +
  'The user may give you the text of the page they are viewing as context. ' +
  'Follow the user\'s instruction. When you write code, give complete, runnable code in one ' +
  'fenced code block with the language name, add short plain-English comments, then a brief explanation.';

// Accept a connection from the page and answer its request
chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== 'page-assistant') return;
  port.onMessage.addListener((request) => streamAssistantReply(port, request));
});

// Ask Ollama and pass each piece of the reply to the page as it arrives
async function streamAssistantReply(port, request) {
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), ASSISTANT_TIMEOUT_MS);
  port.onDisconnect.addListener(() => abort.abort());
  try {
    const model = await readSelectedModel();
    const response = await fetch(OLLAMA_CHAT_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, stream: true, messages: buildAssistantMessages(request), options: { temperature: 0.3 } }),
      signal: abort.signal
    });
    if (!response.ok) throw new Error(await describeOllamaError(response, model));
    await forwardStream(response.body, port);
    safePost(port, { done: true });
  } catch (error) {
    safePost(port, { error: friendlyAssistantError(error) });
  } finally {
    clearTimeout(timer);
  }
}

// The model chosen in the popup, or the default
async function readSelectedModel() {
  const storage = await chrome.storage.local.get(['selectedModel']);
  return storage.selectedModel || DEFAULT_MODEL;
}

// System prompt + the user's instruction, with the page text attached when given
function buildAssistantMessages({ instruction, pageText, pageTitle, pageUrl }) {
  const context = pageText
    ? `Page: ${pageTitle}\nURL: ${pageUrl}\n\n--- PAGE TEXT ---\n${pageText}\n--- END PAGE TEXT ---\n\n`
    : '';
  return [
    { role: 'system', content: ASSISTANT_SYSTEM_PROMPT },
    { role: 'user', content: context + 'Instruction: ' + instruction }
  ];
}

// Ollama sends one JSON object per line; pass on each message's text
async function forwardStream(body, port) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffered = '';
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffered += decoder.decode(value, { stream: true });
    const lines = buffered.split('\n');
    buffered = lines.pop();
    lines.filter((line) => line.trim()).forEach((line) => forwardLine(line, port));
  }
  if (buffered.trim()) forwardLine(buffered, port);
}

// Send the text inside one streamed line to the page
function forwardLine(line, port) {
  const data = JSON.parse(line);
  if (data.error) throw new Error(data.error);
  const text = data.message?.content;
  if (text) safePost(port, { chunk: text });
}

// Turn an Ollama HTTP error into a short message
async function describeOllamaError(response, model) {
  if (response.status === 403) return 'Ollama refused the add-on (403). OLLAMA_ORIGINS must allow chrome-extension://*.';
  if (response.status === 404) return `Model "${model}" is not installed in Ollama. Pick another in the add-on popup.`;
  return `Ollama error ${response.status}: ${(await response.text()).slice(0, 200)}`;
}

// Short on-screen error; full detail goes to the service worker console
function friendlyAssistantError(error) {
  console.error('Page Assistant:', error);
  if (error.name === 'AbortError') return 'Timed out or cancelled.';
  if (String(error.message).includes('Failed to fetch')) return 'Cannot reach Ollama. Is it running?';
  return error.message;
}

// Posting to a page that was closed throws; ignore that
function safePost(port, message) {
  try { port.postMessage(message); } catch (_) { /* page closed */ }
}

// Moodle AI Demo - Background Service Worker
// For academic integrity research demonstration only

const OLLAMA_URL = 'http://localhost:11434/api/generate';
const DEFAULT_MODEL = 'llama3.2';

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

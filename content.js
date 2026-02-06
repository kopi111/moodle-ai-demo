// Moodle AI Demo - Content Script
// For academic integrity research demonstration only

(function() {
  'use strict';

  // Create floating button
  function createFloatingButton() {
    if (document.getElementById('moodle-ai-demo-btn')) return;

    const btn = document.createElement('button');
    btn.id = 'moodle-ai-demo-btn';
    btn.innerHTML = '🤖 Aitken';
    btn.title = 'Analyze quiz questions with AI';
    document.body.appendChild(btn);

    btn.addEventListener('click', analyzeQuiz);
  }

  // Create results panel
  function createResultsPanel() {
    let panel = document.getElementById('moodle-ai-demo-panel');
    if (!panel) {
      panel = document.createElement('div');
      panel.id = 'moodle-ai-demo-panel';
      panel.innerHTML = `<div class="mai-content"><div class="mai-loading">...</div></div>`;
      document.body.appendChild(panel);

      panel.addEventListener('click', () => {
        panel.classList.remove('mai-visible');
      });
    }
    return panel;
  }

  // Extract questions from Moodle quiz page
  function extractQuestions() {
    const questions = [];

    // Moodle quiz question selectors (covers multiple Moodle versions)
    const questionSelectors = [
      '.que',                          // Standard Moodle
      '.formulation',                  // Question formulation
      '[id^="question-"]',             // Question by ID
      '.qtext',                        // Question text container
      '.multiplechoice',               // Multiple choice specific
      '.answeroptions'                 // Answer options
    ];

    // Try to find question containers
    let questionElements = document.querySelectorAll('.que');

    if (questionElements.length === 0) {
      questionElements = document.querySelectorAll('[id^="question-"]');
    }

    questionElements.forEach((qEl, index) => {
      const question = {
        number: index + 1,
        text: '',
        type: 'unknown',
        options: []
      };

      // Extract question text
      const qTextEl = qEl.querySelector('.qtext') ||
                      qEl.querySelector('.formulation p') ||
                      qEl.querySelector('.formulation');

      if (qTextEl) {
        question.text = qTextEl.innerText.trim();
      }

      // Determine question type
      if (qEl.classList.contains('multichoice') || qEl.querySelector('input[type="radio"]')) {
        question.type = 'multiple_choice';
      } else if (qEl.querySelector('input[type="checkbox"]')) {
        question.type = 'multiple_answer';
      } else if (qEl.querySelector('input[type="text"]')) {
        question.type = 'short_answer';
      } else if (qEl.querySelector('textarea')) {
        question.type = 'essay';
      }

      // Extract answer options for multiple choice
      const answerContainer = qEl.querySelector('.answer') || qEl;
      const optionElements = answerContainer.querySelectorAll('.d-flex, .r0, .r1, [class*="option"], label');

      optionElements.forEach(optEl => {
        const input = optEl.querySelector('input[type="radio"], input[type="checkbox"]');
        const labelText = optEl.innerText.trim();

        if (labelText && labelText.length > 0) {
          // Clean up the option text
          const cleanText = labelText.replace(/^[a-zA-Z]\.\s*/, '').trim();
          if (cleanText.length > 0 && !question.options.includes(cleanText)) {
            question.options.push(cleanText);
          }
        }
      });

      // Alternative: look for answer labels directly
      if (question.options.length === 0) {
        const labels = qEl.querySelectorAll('.answernumber + span, .flex-fill, .ml-1');
        labels.forEach(label => {
          const text = label.innerText.trim();
          if (text && !question.options.includes(text)) {
            question.options.push(text);
          }
        });
      }

      if (question.text) {
        questions.push(question);
      }
    });

    // Fallback: try generic form detection
    if (questions.length === 0) {
      const forms = document.querySelectorAll('form');
      forms.forEach(form => {
        const radioGroups = {};
        form.querySelectorAll('input[type="radio"]').forEach(radio => {
          const name = radio.name;
          if (!radioGroups[name]) {
            radioGroups[name] = {
              number: Object.keys(radioGroups).length + 1,
              text: '',
              type: 'multiple_choice',
              options: []
            };
          }
          const label = form.querySelector(`label[for="${radio.id}"]`) || radio.parentElement;
          if (label) {
            radioGroups[name].options.push(label.innerText.trim());
          }
        });

        Object.values(radioGroups).forEach(q => {
          if (q.options.length > 0) {
            questions.push(q);
          }
        });
      });
    }

    return questions;
  }

  // Send questions to AI via background script
  async function analyzeQuiz() {
    const panel = createResultsPanel();
    panel.classList.add('mai-visible');

    const contentDiv = panel.querySelector('.mai-content');
    contentDiv.innerHTML = '<div class="mai-loading">...</div>';

    const questions = extractQuestions();

    if (questions.length === 0) {
      contentDiv.innerHTML = `<span class="mai-error">No questions found</span>`;
      return;
    }

    contentDiv.innerHTML = `<div class="mai-loading">Loading ${questions.length}...</div>`;

    try {
      // Send to background script for Ollama processing
      const response = await chrome.runtime.sendMessage({
        action: 'analyzeQuestions',
        questions: questions
      });

      if (response.error) {
        throw new Error(response.error);
      }

      displayResults(contentDiv, questions, response.answers);
    } catch (error) {
      contentDiv.innerHTML = `<span class="mai-error">Error: ${error.message}</span>`;
    }
  }

  // Display results in panel - compact format
  function displayResults(container, questions, answers) {
    let results = [];

    questions.forEach((q, i) => {
      const answer = answers[i] || { answerIndex: -1 };
      const letter = answer.answerIndex >= 0 ? String.fromCharCode(65 + answer.answerIndex) : '?';
      results.push(`${q.number}:${letter}`);
    });

    container.innerHTML = results.join(', ');
  }

  function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  // Initialize when page loads
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', createFloatingButton);
  } else {
    createFloatingButton();
  }

  // Also listen for dynamic page changes (SPA support)
  const observer = new MutationObserver(() => {
    createFloatingButton();
  });
  observer.observe(document.body, { childList: true, subtree: true });

})();

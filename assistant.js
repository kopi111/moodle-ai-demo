// Page Assistant - content script
// Adds a "💬 Ask" button. It opens a text box where you tell the AI what to do,
// using the text of the current page as context. If the page asks for code,
// a small bubble offers to help write it.

(function () {
  'use strict';

  // Ids and limits used across the script
  const BUTTON_ID = 'page-assistant-btn';
  const PANEL_ID = 'page-assistant-panel';
  const OFFER_ID = 'page-assistant-offer';
  const MAX_PAGE_CHARACTERS = 8000;
  const CODE_TASK_PATTERN =
    /\b(write|create|make|develop|build|design|implement)\b[^.\n]{0,80}\b(code|program|script|function|class|app|application|algorithm|loop)\b/i;

  // ---------- Button ----------

  // Put the "💬 Ask" button on the page once
  function createAskButton() {
    if (document.getElementById(BUTTON_ID)) return;
    const button = document.createElement('button');
    button.id = BUTTON_ID;
    button.textContent = '💬 Ask';
    button.title = 'Ask the AI about this page';
    button.addEventListener('click', togglePanel);
    document.body.appendChild(button);
  }

  // ---------- Panel ----------

  // Build the panel (header, text box, send button, answer area) once
  function createPanel() {
    const existing = document.getElementById(PANEL_ID);
    if (existing) return existing;

    const panel = document.createElement('div');
    panel.id = PANEL_ID;
    panel.innerHTML = `
      <div class="pa-header">
        <span>💬 Page Assistant</span>
        <button class="pa-close" title="Close">✕</button>
      </div>
      <textarea class="pa-input" rows="4"
        placeholder="Tell me what to do… e.g. 'Write the Python code for the task on this page'"></textarea>
      <div class="pa-row">
        <label><input type="checkbox" class="pa-use-page" checked> Use this page as context</label>
        <button class="pa-send">Send</button>
      </div>
      <div class="pa-hint">Ctrl+Enter to send · select text on the page to use only that</div>
      <div class="pa-output"></div>`;
    document.body.appendChild(panel);

    panel.querySelector('.pa-close').addEventListener('click', hidePanel);
    panel.querySelector('.pa-send').addEventListener('click', sendInstruction);
    panel.querySelector('.pa-input').addEventListener('keydown', sendOnCtrlEnter);
    return panel;
  }

  // Show the panel if hidden, hide it if shown
  function togglePanel() {
    const panel = createPanel();
    if (panel.classList.contains('pa-visible')) hidePanel();
    else showPanel('');
  }

  // Show the panel, optionally filling the text box, and focus the box
  function showPanel(prefilledInstruction) {
    const panel = createPanel();
    const input = panel.querySelector('.pa-input');
    if (prefilledInstruction) input.value = prefilledInstruction;
    panel.classList.add('pa-visible');
    input.focus();
  }

  // Hide the panel
  function hidePanel() {
    createPanel().classList.remove('pa-visible');
  }

  // Ctrl+Enter (or Cmd+Enter) in the text box sends the instruction
  function sendOnCtrlEnter(event) {
    if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
      event.preventDefault();
      sendInstruction();
    }
  }

  // ---------- Reading the page ----------

  // Text the user highlighted, or the whole page text without our own panel
  function readPageText() {
    const selected = window.getSelection().toString().trim();
    if (selected) return selected;
    const clone = document.body.cloneNode(true);
    [BUTTON_ID, PANEL_ID, OFFER_ID].forEach((id) => clone.querySelector('#' + id)?.remove());
    return (clone.innerText || clone.textContent || '').replace(/\n{3,}/g, '\n\n').trim();
  }

  // The first line on the page that looks like "write a program / make a code…"
  function findCodeTask() {
    const lines = (document.body.innerText || '').split('\n');
    return lines.map((line) => line.trim()).find((line) => CODE_TASK_PATTERN.test(line)) || '';
  }

  // ---------- Talking to the AI ----------

  // Send the instruction (plus page text) to the background script and stream the reply
  function sendInstruction() {
    const panel = createPanel();
    const instruction = panel.querySelector('.pa-input').value.trim();
    const output = panel.querySelector('.pa-output');
    const sendButton = panel.querySelector('.pa-send');
    if (!instruction) {
      showError(output, 'Type what you want me to do in the box first.');
      return;
    }

    const usePage = panel.querySelector('.pa-use-page').checked;
    const request = {
      instruction,
      pageText: usePage ? readPageText().slice(0, MAX_PAGE_CHARACTERS) : '',
      pageTitle: document.title,
      pageUrl: location.href
    };

    sendButton.disabled = true;
    output.textContent = 'Thinking… (the first answer can take a while on CPU)';
    streamAnswer(request, output, () => { sendButton.disabled = false; });
  }

  // Open a port to the background script, show text as it arrives
  function streamAnswer(request, output, whenFinished) {
    let answerText = '';
    const port = chrome.runtime.connect({ name: 'page-assistant' });

    port.onMessage.addListener((message) => {
      if (message.chunk) {
        answerText += message.chunk;
        renderAnswer(output, answerText);
      }
      if (message.error) {
        showError(output, message.error);
        whenFinished();
      }
      if (message.done) whenFinished();
    });
    port.onDisconnect.addListener(whenFinished);
    port.postMessage(request);
  }

  // ---------- Showing the answer ----------

  // Split the answer into plain text and ``` code blocks and draw them safely
  function renderAnswer(output, answerText) {
    output.replaceChildren();
    const parts = answerText.split(/```/);
    parts.forEach((part, index) => {
      const isCode = index % 2 === 1;
      if (!isCode && !part.trim()) return;
      output.appendChild(isCode ? buildCodeBlock(part) : buildTextBlock(part));
    });
    output.scrollTop = output.scrollHeight;
  }

  // A plain paragraph of answer text
  function buildTextBlock(text) {
    const block = document.createElement('div');
    block.className = 'pa-text';
    block.textContent = text.trim();
    return block;
  }

  // A code box with a language label and a Copy button
  function buildCodeBlock(rawCode) {
    const firstNewLine = rawCode.indexOf('\n');
    const language = firstNewLine > 0 ? rawCode.slice(0, firstNewLine).trim() : '';
    const code = firstNewLine > 0 ? rawCode.slice(firstNewLine + 1) : rawCode;

    const wrapper = document.createElement('div');
    wrapper.className = 'pa-code';
    const bar = document.createElement('div');
    bar.className = 'pa-code-bar';
    bar.textContent = language || 'code';
    const copyButton = document.createElement('button');
    copyButton.textContent = 'Copy';
    copyButton.addEventListener('click', () => copyCode(code, copyButton));
    bar.appendChild(copyButton);

    const pre = document.createElement('pre');
    pre.textContent = code.replace(/\s+$/, '');
    wrapper.append(bar, pre);
    return wrapper;
  }

  // Copy code to the clipboard and say so on the button
  function copyCode(code, button) {
    navigator.clipboard.writeText(code.trim())
      .then(() => { button.textContent = 'Copied ✓'; })
      .catch(() => { button.textContent = 'Copy failed'; });
    setTimeout(() => { button.textContent = 'Copy'; }, 2000);
  }

  // Short red error message in the answer area
  function showError(output, message) {
    output.replaceChildren();
    const error = document.createElement('div');
    error.className = 'pa-error';
    error.textContent = message;
    output.appendChild(error);
  }

  // ---------- "This page asks for code" offer ----------

  // If the page asks for code, ask once whether to help write it
  function offerHelpWithCodeTask() {
    const task = findCodeTask();
    if (!task || wasOfferDismissed()) return;

    const offer = document.createElement('div');
    offer.id = OFFER_ID;
    const question = document.createElement('div');
    question.textContent = 'This page asks for code: "' + task.slice(0, 140) + '". Want me to help write it?';
    const yesButton = document.createElement('button');
    yesButton.textContent = 'Yes';
    const noButton = document.createElement('button');
    noButton.textContent = 'No';
    noButton.className = 'pa-secondary';
    offer.append(question, yesButton, noButton);
    document.body.appendChild(offer);

    yesButton.addEventListener('click', () => {
      offer.remove();
      showPanel('Write the code for this task from the page: "' + task + '"');
    });
    noButton.addEventListener('click', () => {
      offer.remove();
      rememberOfferDismissed();
    });
  }

  // Remember "No" for this page for the rest of the browser session
  function rememberOfferDismissed() {
    try { sessionStorage.setItem('page-assistant-dismissed:' + location.pathname, '1'); } catch (_) { /* storage blocked */ }
  }

  // Did the user already say "No" on this page?
  function wasOfferDismissed() {
    try { return sessionStorage.getItem('page-assistant-dismissed:' + location.pathname) === '1'; } catch (_) { return false; }
  }

  // ---------- Start ----------

  // Add the button and check the page for a code task
  function start() {
    createAskButton();
    setTimeout(offerHelpWithCodeTask, 1500);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();

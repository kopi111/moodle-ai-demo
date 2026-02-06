// Moodle AI Demo - Popup Script

document.addEventListener('DOMContentLoaded', async () => {
  const ollamaStatus = document.getElementById('ollama-status');
  const modelStatus = document.getElementById('model-status');
  const modelSelect = document.getElementById('model');

  // Load saved model preference
  chrome.storage.local.get(['selectedModel'], (result) => {
    if (result.selectedModel) {
      modelSelect.value = result.selectedModel;
    }
  });

  // Save model preference when changed
  modelSelect.addEventListener('change', () => {
    chrome.storage.local.set({ selectedModel: modelSelect.value });
    checkOllama();
  });

  // Check Ollama connection
  async function checkOllama() {
    ollamaStatus.textContent = 'Checking...';
    ollamaStatus.className = 'status-value checking';
    modelStatus.textContent = 'Loading...';
    modelStatus.className = 'status-value checking';

    try {
      // Check if Ollama is running
      const response = await fetch('http://localhost:11434/api/tags');

      if (!response.ok) {
        throw new Error('Ollama not responding');
      }

      const data = await response.json();
      ollamaStatus.textContent = 'Connected';
      ollamaStatus.className = 'status-value connected';

      // Check if selected model is available
      const selectedModel = modelSelect.value;
      const models = data.models || [];
      const modelNames = models.map(m => m.name.split(':')[0]);

      if (modelNames.includes(selectedModel) || modelNames.some(n => n.startsWith(selectedModel))) {
        modelStatus.textContent = `${selectedModel} Ready`;
        modelStatus.className = 'status-value connected';
      } else {
        modelStatus.textContent = `${selectedModel} Not Found`;
        modelStatus.className = 'status-value disconnected';
      }

    } catch (error) {
      ollamaStatus.textContent = 'Not Running';
      ollamaStatus.className = 'status-value disconnected';
      modelStatus.textContent = 'N/A';
      modelStatus.className = 'status-value disconnected';
    }
  }

  // Initial check
  checkOllama();

  // Recheck every 5 seconds
  setInterval(checkOllama, 5000);
});

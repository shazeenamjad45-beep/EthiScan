/**
 * EthiScan Extension Popup Dashboard Logic
 */

document.addEventListener('DOMContentLoaded', async () => {
  // DOM Elements
  const body = document.body;
  const themeToggle = document.getElementById('theme-toggle');
  const themeIconSun = document.getElementById('theme-icon-sun');
  const themeIconMoon = document.getElementById('theme-icon-moon');
  
  const settingsToggle = document.getElementById('settings-toggle');
  const settingsPanel = document.getElementById('settings-panel');
  const closeSettings = document.getElementById('close-settings');
  const geminiKeyInput = document.getElementById('gemini-key');
  const saveSettingsBtn = document.getElementById('save-settings');

  const mainContent = document.getElementById('main-content');
  const appFooter = document.getElementById('app-footer');
  
  const activeDomainEl = document.getElementById('active-domain');
  const scanStatusEl = document.getElementById('scan-status');
  const gradeBadgeEl = document.getElementById('grade-badge');
  const trustScoreEl = document.getElementById('trust-score');
  const scoreBarEl = document.getElementById('score-bar');
  const summaryTextEl = document.getElementById('executive-summary-text');
  
  const presetTabs = document.querySelectorAll('.preset-tab');
  const scanBtn = document.getElementById('scan-btn');
  const scanBtnText = document.getElementById('scan-btn-text');
  const scanSpinner = document.getElementById('scan-spinner');
  
  const countMedia = document.getElementById('count-media');
  const barMedia = document.getElementById('bar-media');
  const countData = document.getElementById('count-data');
  const barData = document.getElementById('bar-data');
  const countFinancial = document.getElementById('count-financial');
  const barFinancial = document.getElementById('bar-financial');
  const countRights = document.getElementById('count-rights');
  const barRights = document.getElementById('bar-rights');
  
  const clausesListEl = document.getElementById('clauses-list');
  const totalClausesCountEl = document.getElementById('total-clauses-count');

  // Storage state - Default initial theme is 'light'
  const storage = await chrome.storage.local.get([
    'theme', 
    'geminiApiKey', 
    'selectedPreset',
    'lastScanResult',
    'lastScanDomain'
  ]);

  let currentTheme = storage.theme || 'light';
  applyTheme(currentTheme);

  if (storage.geminiApiKey) geminiKeyInput.value = storage.geminiApiKey;
  
  let currentPreset = storage.selectedPreset || 'standard';
  setActivePresetTab(currentPreset);

  // Active Tab Domain
  let activeTab = null;
  try {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    activeTab = tabs[0];
    if (activeTab && activeTab.url) {
      const hostname = extractHostname(activeTab.url);
      activeDomainEl.textContent = hostname;
    }
  } catch (e) {
    activeDomainEl.textContent = 'Active Document';
  }

  // --- Event Listeners --- //

  themeToggle.addEventListener('click', () => {
    currentTheme = currentTheme === 'light' ? 'dark' : 'light';
    applyTheme(currentTheme);
    chrome.storage.local.set({ theme: currentTheme });
  });

  settingsToggle.addEventListener('click', () => {
    openSettingsView();
  });

  closeSettings.addEventListener('click', () => {
    closeSettingsView();
  });

  saveSettingsBtn.addEventListener('click', async () => {
    const key = geminiKeyInput.value.trim();
    await chrome.storage.local.set({ geminiApiKey: key });
    closeSettingsView();
    triggerScan();
  });

  presetTabs.forEach(tab => {
    tab.addEventListener('click', async () => {
      currentPreset = tab.dataset.preset;
      setActivePresetTab(currentPreset);
      await chrome.storage.local.set({ selectedPreset: currentPreset });
      triggerScan();
    });
  });

  scanBtn.addEventListener('click', () => triggerScan());

  // Trigger Scan on Open
  triggerScan();

  // --- Helper Functions --- //

  function openSettingsView() {
    mainContent.classList.add('hidden');
    appFooter.classList.add('hidden');
    settingsPanel.classList.remove('hidden');
  }

  function closeSettingsView() {
    settingsPanel.classList.add('hidden');
    mainContent.classList.remove('hidden');
    appFooter.classList.remove('hidden');
  }

  async function triggerScan() {
    setScanLoadingState(true);
    
    try {
      const response = await chrome.runtime.sendMessage({
        action: 'START_POLICY_SCAN',
        tabId: activeTab?.id,
        preset: currentPreset,
        language: 'en'
      });

      if (response && response.success && response.result) {
        renderScanResult(response.result);
      } else if (response && response.error) {
        showErrorState(response.error);
      }
    } catch (err) {
      console.error('[EthiScan Popup Error]:', err);
    } finally {
      setScanLoadingState(false);
    }
  }

  function applyTheme(theme) {
    if (theme === 'light') {
      body.classList.remove('theme-dark');
      body.classList.add('theme-light');
      themeIconSun.classList.add('hidden');
      themeIconMoon.classList.remove('hidden');
    } else {
      body.classList.remove('theme-light');
      body.classList.add('theme-dark');
      themeIconMoon.classList.add('hidden');
      themeIconSun.classList.remove('hidden');
    }
  }

  function setActivePresetTab(preset) {
    presetTabs.forEach(t => {
      if (t.dataset.preset === preset) {
        t.classList.add('active');
      } else {
        t.classList.remove('active');
      }
    });
  }

  function setScanLoadingState(isLoading) {
    if (isLoading) {
      scanBtn.disabled = true;
      scanSpinner.classList.remove('hidden');
      scanBtnText.textContent = 'Evaluating Legal Text...';
      scanStatusEl.textContent = 'Scanning';
      scanStatusEl.className = 'status-pill scanning';
    } else {
      scanBtn.disabled = false;
      scanSpinner.classList.add('hidden');
      scanBtnText.textContent = 'Re-Scan Current Page';
    }
  }

  function renderScanResult(result) {
    if (!result) return;

    scanStatusEl.textContent = 'Active Shield';
    scanStatusEl.className = 'status-pill active';

    const rawGrade = result.trust_grade || result.summary?.trust_grade || 'C';
    const score = result.safety_score !== undefined ? result.safety_score : (result.summary?.safety_score || 50);

    const baseGradeLetter = rawGrade.charAt(0).toUpperCase();

    gradeBadgeEl.textContent = rawGrade;
    gradeBadgeEl.className = `grade-badge grade-${baseGradeLetter}`;
    
    trustScoreEl.textContent = `${score} / 100`;
    scoreBarEl.style.width = `${score}%`;
    scoreBarEl.style.backgroundColor = getScoreColor(score);

    const summaryDesc = result.summary?.description || result.description || `Evaluated privacy terms for ${result.domain || 'current page'}.`;
    summaryTextEl.textContent = summaryDesc;

    const pillars = result.pillars || result.summary?.pillars || { media: 0, data: 0, financial: 0, rights: 0 };
    countMedia.textContent = pillars.media || 0;
    barMedia.style.width = `${Math.min((pillars.media || 0) * 33, 100)}%`;

    countData.textContent = pillars.data || 0;
    barData.style.width = `${Math.min((pillars.data || 0) * 33, 100)}%`;

    countFinancial.textContent = pillars.financial || 0;
    barFinancial.style.width = `${Math.min((pillars.financial || 0) * 33, 100)}%`;

    countRights.textContent = pillars.rights || 0;
    barRights.style.width = `${Math.min((pillars.rights || 0) * 33, 100)}%`;

    const clauses = result.risk_clauses || [];
    totalClausesCountEl.textContent = `${clauses.length} found`;

    if (clauses.length === 0) {
      clausesListEl.innerHTML = `
        <div class="empty-state">
          <span>General page or no critical hazardous clauses detected on this URL.</span>
        </div>
      `;
      return;
    }

    clausesListEl.innerHTML = clauses.map(c => `
      <div class="clause-item severity-${(c.severity || 'medium').toLowerCase()}">
        <div class="clause-header">
          <span class="clause-category">${escapeHtml(c.category || 'General Risk')}</span>
          <span class="clause-severity-badge ${(c.severity || 'medium').toLowerCase()}">${c.severity || 'MEDIUM'}</span>
        </div>
        <div class="clause-text">${escapeHtml(c.explanation || c.verbatim_quote)}</div>
      </div>
    `).join('');
  }

  function showErrorState(msg) {
    scanStatusEl.textContent = 'Scan Error';
    scanStatusEl.className = 'status-pill idle';
    summaryTextEl.textContent = `Notice: ${msg}`;
  }

  function getScoreColor(score) {
    if (score >= 80) return '#16a34a';
    if (score >= 65) return '#2563eb';
    if (score >= 50) return '#d97706';
    if (score >= 35) return '#ea580c';
    return '#dc2626';
  }

  function extractHostname(urlStr) {
    try {
      const url = new URL(urlStr);
      return url.hostname || 'Active Document';
    } catch (e) {
      return 'Active Document';
    }
  }

  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }
});

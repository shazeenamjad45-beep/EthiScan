/**
 * EthiScan Content Script: Resilient DOM Scraper, Live Highlighter & Shadow DOM Tooltip Engine
 */

(function () {
  if (window.__ETHISCAN_LOADED__) return;
  window.__ETHISCAN_LOADED__ = true;

  console.log('[EthiScan] Content script initialized on:', window.location.hostname);

  let shadowHost = null;
  let shadowRoot = null;
  let tooltipCard = null;
  let currentHighlightedMarks = [];
  let currentTheme = 'dark';

  chrome.storage.local.get(['theme'], (res) => {
    if (res.theme) currentTheme = res.theme;
  });

  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'EXTRACT_PAGE_TEXT') {
      const text = extractCleanText();
      sendResponse({
        success: true,
        domain: window.location.hostname || 'Active Document',
        textContent: text
      });
      return true;
    }

    if (request.action === 'APPLY_HIGHLIGHTS' && request.result) {
      applyDomHighlights(request.result.risk_clauses || []);
      sendResponse({ success: true });
      return true;
    }
  });

  /**
   * DOM Scraper: Extracts text from body, iframe embeds, and text nodes
   */
  function extractCleanText() {
    let bodyText = '';
    
    if (document.body) {
      const clone = document.body.cloneNode(true);
      const ignoreSelectors = ['script', 'style', 'noscript', 'svg', 'iframe', 'nav', 'header', 'footer', '.ad', '.ads', '[aria-hidden="true"]'];
      ignoreSelectors.forEach(selector => {
        clone.querySelectorAll(selector).forEach(el => el.remove());
      });

      bodyText = clone.innerText || clone.textContent || '';
    }

    // Fallback: Check document.documentElement if body text is minimal
    if (!bodyText || bodyText.length < 30) {
      bodyText = document.documentElement.innerText || document.documentElement.textContent || '';
    }

    return bodyText.replace(/\s+/g, ' ').trim();
  }

  /**
   * Highlighting Engine
   */
  function applyDomHighlights(riskClauses) {
    if (!riskClauses || riskClauses.length === 0) return;

    clearHighlights();
    initShadowDOM();

    riskClauses.forEach(clause => {
      if (clause.verbatim_quote) {
        highlightVerbatimQuote(clause);
      }
    });
  }

  function highlightVerbatimQuote(clause) {
    const quote = clause.verbatim_quote.trim();
    if (!quote || quote.length < 5) return;

    const severityClass = (clause.severity || 'medium').toLowerCase() === 'high' ? 'ethiscan-severity-high' : 'ethiscan-severity-medium';

    const walker = document.createTreeWalker(
      document.body || document.documentElement,
      NodeFilter.SHOW_TEXT,
      {
        acceptNode: function (node) {
          const parent = node.parentElement;
          if (!parent) return NodeFilter.FILTER_REJECT;

          const tag = parent.tagName.toLowerCase();
          if (['script', 'style', 'noscript', 'textarea', 'input', 'mark', 'code'].includes(tag)) {
            return NodeFilter.FILTER_REJECT;
          }
          if (parent.closest('#ethiscan-shadow-host')) return NodeFilter.FILTER_REJECT;

          return node.nodeValue.trim().length > 0 ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
        }
      }
    );

    const targetNodes = [];
    let currentNode = walker.nextNode();
    const quoteKeywords = quote.toLowerCase().split(/\s+/).filter(w => w.length > 3);
    if (quoteKeywords.length === 0) return;

    while (currentNode) {
      const nodeText = currentNode.nodeValue;
      const lowerNodeText = nodeText.toLowerCase();

      if (lowerNodeText.includes(quote.toLowerCase()) || containsKeywordCluster(lowerNodeText, quoteKeywords)) {
        targetNodes.push(currentNode);
      }
      currentNode = walker.nextNode();
    }

    targetNodes.slice(0, 5).forEach(textNode => {
      try {
        const mark = document.createElement('mark');
        mark.className = `ethiscan-highlight ${severityClass}`;
        mark.setAttribute('data-ethiscan-clause', JSON.stringify(clause));

        const parent = textNode.parentNode;
        if (!parent) return;

        mark.textContent = textNode.nodeValue;
        parent.replaceChild(mark, textNode);
        currentHighlightedMarks.push(mark);

        mark.addEventListener('mouseenter', (e) => showTooltip(e.currentTarget, clause));
        mark.addEventListener('mouseleave', () => scheduleHideTooltip());
        mark.addEventListener('click', (e) => {
          e.stopPropagation();
          showTooltip(e.currentTarget, clause);
        });
      } catch (err) {
        console.warn('[EthiScan] Highlight wrap warning:', err);
      }
    });
  }

  function containsKeywordCluster(text, keywords) {
    let matchCount = 0;
    for (const kw of keywords) {
      if (text.includes(kw)) matchCount++;
    }
    return matchCount >= Math.min(2, keywords.length);
  }

  function initShadowDOM() {
    if (shadowHost) return;

    shadowHost = document.createElement('div');
    shadowHost.id = 'ethiscan-shadow-host';
    (document.body || document.documentElement).appendChild(shadowHost);

    shadowRoot = shadowHost.attachShadow({ mode: 'open' });

    const styleLink = document.createElement('link');
    styleLink.rel = 'stylesheet';
    styleLink.href = chrome.runtime.getURL('styles/shadow_tooltip.css');
    shadowRoot.appendChild(styleLink);

    tooltipCard = document.createElement('div');
    tooltipCard.className = `tooltip-card theme-${currentTheme}`;
    tooltipCard.innerHTML = `
      <div class="tooltip-header">
        <div class="tooltip-brand">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#2563eb" stroke-width="2">
            <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
          </svg>
          <span>EthiScan Alert</span>
        </div>
        <div id="tt-badge" class="tooltip-badge badge-high">
          <span id="tt-dot" class="status-dot dot-high"></span>
          <span id="tt-severity">HIGH RISK</span>
        </div>
      </div>
      <div class="tooltip-body">
        <div id="tt-category" class="category-title">Media & Identity Protection</div>
        <div id="tt-explanation" class="explanation-text">Explanation content...</div>
        <div id="tt-frameworks" class="framework-list"></div>
        <div id="tt-quote" class="quote-box">"Verbatim quote..."</div>
      </div>
      <div class="tooltip-footer">
        <span>Global Privacy Matrix Verified</span>
        <button id="tt-close" class="close-btn" aria-label="Close">&times;</button>
      </div>
    `;

    shadowRoot.appendChild(tooltipCard);

    const closeBtn = tooltipCard.querySelector('#tt-close');
    if (closeBtn) closeBtn.addEventListener('click', () => hideTooltip());

    tooltipCard.addEventListener('mouseenter', () => cancelHideTooltip());
    tooltipCard.addEventListener('mouseleave', () => scheduleHideTooltip());
  }

  let hideTimeout = null;

  function showTooltip(targetElement, clause) {
    cancelHideTooltip();
    if (!tooltipCard) return;

    const severity = (clause.severity || 'MEDIUM').toUpperCase();
    const isHigh = severity === 'HIGH';

    const ttBadge = shadowRoot.querySelector('#tt-badge');
    const ttDot = shadowRoot.querySelector('#tt-dot');
    const ttSeverity = shadowRoot.querySelector('#tt-severity');
    const ttCategory = shadowRoot.querySelector('#tt-category');
    const ttExplanation = shadowRoot.querySelector('#tt-explanation');
    const ttFrameworks = shadowRoot.querySelector('#tt-frameworks');
    const ttQuote = shadowRoot.querySelector('#tt-quote');

    ttBadge.className = `tooltip-badge ${isHigh ? 'badge-high' : 'badge-medium'}`;
    ttDot.className = `status-dot ${isHigh ? 'dot-high' : 'dot-medium'}`;
    ttSeverity.textContent = `${severity} RISK`;
    ttCategory.textContent = clause.category || 'Hazardous Clause';
    ttExplanation.textContent = clause.explanation || 'Potentially hazardous terms identified in contract.';
    
    const frameworks = clause.violated_frameworks || ['GDPR', 'CCPA'];
    ttFrameworks.innerHTML = frameworks.map(f => `<span class="framework-tag">${escapeHtml(f)}</span>`).join('');
    
    ttQuote.textContent = `"${clause.verbatim_quote || ''}"`;

    const rect = targetElement.getBoundingClientRect();
    const scrollTop = window.pageYOffset || document.documentElement.scrollTop;
    const scrollLeft = window.pageXOffset || document.documentElement.scrollLeft;

    let top = rect.bottom + scrollTop + 6;
    let left = rect.left + scrollLeft;

    if (left + 330 > window.innerWidth) {
      left = Math.max(10, window.innerWidth - 340);
    }

    tooltipCard.style.top = `${top}px`;
    tooltipCard.style.left = `${left}px`;
    tooltipCard.className = `tooltip-card theme-${currentTheme} visible`;
  }

  function scheduleHideTooltip() {
    hideTimeout = setTimeout(() => hideTooltip(), 300);
  }

  function cancelHideTooltip() {
    if (hideTimeout) clearTimeout(hideTimeout);
  }

  function hideTooltip() {
    if (tooltipCard) tooltipCard.classList.remove('visible');
  }

  function clearHighlights() {
    currentHighlightedMarks.forEach(mark => {
      const parent = mark.parentNode;
      if (parent) parent.replaceChild(document.createTextNode(mark.textContent), mark);
    });
    currentHighlightedMarks = [];
  }

  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }
})();

import { DOM } from './dom.js';
import { appState } from './state.js';
import { renderPreview, reformatMarkdown, buildMediumHtml } from './markdownEngine.js';

function setTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  localStorage.setItem('m2m-theme', theme);
}

function initTypewriter() {
  const el = document.getElementById('typewriter-text');
  if (!el) return;

  const phrases = ['Markdown to Medium', 'Medium to Markdown'];
  const TYPE_SPEED   = 60;
  const DELETE_SPEED = 35;
  const PAUSE_AFTER  = 2200;
  const PAUSE_BEFORE = 400;

  let phraseIndex = 0;
  let charIndex   = 0;
  let deleting    = false;

  function tick() {
    const phrase = phrases[phraseIndex];
    if (!deleting) {
      charIndex++;
      el.textContent = phrase.slice(0, charIndex);
      if (charIndex === phrase.length) {
        deleting = true;
        setTimeout(tick, PAUSE_AFTER);
        return;
      }
      setTimeout(tick, TYPE_SPEED);
    } else {
      charIndex--;
      el.textContent = phrase.slice(0, charIndex);

      if (charIndex === 0) {
        deleting = false;
        phraseIndex = (phraseIndex + 1) % phrases.length;
        setTimeout(tick, PAUSE_BEFORE);
        return;
      }
      setTimeout(tick, DELETE_SPEED);
    }
  }
  setTimeout(tick, 600);
}

export function setupUI() {
  const savedTheme = localStorage.getItem('m2m-theme') || 'light';
  setTheme(savedTheme);

  if (DOM.themeToggle) {
    DOM.themeToggle.addEventListener('click', () => {
      const current = document.documentElement.getAttribute('data-theme');
      setTheme(current === 'dark' ? 'light' : 'dark');
    });
  }

  initTypewriter();

  // Tab Switching
  if (DOM.tabButtons && DOM.tabPanels) {
    DOM.tabButtons.forEach((btn) => {
      btn.addEventListener('click', () => {
        const targetTab = btn.dataset.tab;
        DOM.tabButtons.forEach((b) => {
          b.classList.remove('active');
          b.setAttribute('aria-selected', 'false');
        });
        btn.classList.add('active');
        btn.setAttribute('aria-selected', 'true');

        DOM.tabPanels.forEach((panel) => {
          const isActive = panel.id === `panel-${targetTab}`;
          panel.classList.toggle('active', isActive);
          panel.hidden = !isActive;
        });
      });
    });
  }

  // Live Markdown Preview typing debounce
  let debounceTimer;
  if (DOM.markdownInput) {
    DOM.markdownInput.addEventListener('input', () => {
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(renderPreview, 150);
    });

    // Sync Scrolling MD -> Medium
    DOM.markdownInput.addEventListener('scroll', () => {
      if (appState.isSyncingScroll) return;
      appState.isSyncingScroll = true;
      const editorScrollable = DOM.markdownInput.scrollHeight - DOM.markdownInput.clientHeight;
      if (editorScrollable > 0 && DOM.previewContent) {
        const ratio = DOM.markdownInput.scrollTop / editorScrollable;
        const previewScrollable = DOM.previewContent.scrollHeight - DOM.previewContent.clientHeight;
        DOM.previewContent.scrollTop = ratio * previewScrollable;
      }
      requestAnimationFrame(() => { appState.isSyncingScroll = false; });
    });
  }

  // Sync Scrolling Medium -> MD
  if (DOM.previewContent) {
    DOM.previewContent.addEventListener('scroll', () => {
      if (appState.isSyncingScroll) return;
      appState.isSyncingScroll = true;
      const previewScrollable = DOM.previewContent.scrollHeight - DOM.previewContent.clientHeight;
      if (previewScrollable > 0 && DOM.markdownInput) {
        const ratio = DOM.previewContent.scrollTop / previewScrollable;
        const editorScrollable = DOM.markdownInput.scrollHeight - DOM.markdownInput.clientHeight;
        DOM.markdownInput.scrollTop = ratio * editorScrollable;
      }
      requestAnimationFrame(() => { appState.isSyncingScroll = false; });
    });
  }

  // Reformat & Clear
  if (DOM.reformatBtn) {
    DOM.reformatBtn.addEventListener('click', () => {
      const md = DOM.markdownInput?.value;
      if (!md?.trim()) return;
      DOM.markdownInput.value = reformatMarkdown(md);
      renderPreview();
    });
  }

  if (DOM.clearBtn) {
    DOM.clearBtn.addEventListener('click', () => {
      if (!DOM.markdownInput?.value.trim()) return;
      DOM.markdownInput.value = '';
      renderPreview();
      DOM.markdownInput.focus();
    });
  }

  // Fetch MD URL
  if (DOM.mdUrlInput) {
    DOM.mdUrlInput.addEventListener('input', () => {
      if (!DOM.mdUrlInput.value.trim() && DOM.mdUrlErrorBar) {
        clearTimeout(appState.mdUrlSuccessTimer);
        DOM.mdUrlErrorBar.hidden = true;
        DOM.mdUrlErrorBar.textContent = '';
        DOM.mdUrlErrorBar.className = 'md-url-error-bar';
      }
    });
  }

  if (DOM.mdUrlForm) {
    DOM.mdUrlForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const url = DOM.mdUrlInput.value.trim();
      if (!url) return;

      DOM.mdUrlFetchBtn.disabled = true;
      DOM.mdUrlFetchBtn.querySelector('.md-url-fetch-text').hidden = true;
      DOM.mdUrlFetchBtn.querySelector('.md-url-fetch-loader').hidden = false;
      clearTimeout(appState.mdUrlSuccessTimer);
      if(DOM.mdUrlErrorBar) {
          DOM.mdUrlErrorBar.hidden = true;
          DOM.mdUrlErrorBar.textContent = '';
          DOM.mdUrlErrorBar.className = 'md-url-error-bar';
      }

      try {
        const response = await fetch('/api/fetch-md', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ url }),
        });

        const data = await response.json();
        if (!response.ok) throw new Error(data.error || 'Failed to fetch');

        DOM.markdownInput.value = data.content;
        renderPreview();

        if (DOM.mdUrlErrorBar) {
            DOM.mdUrlErrorBar.textContent = '✓ Loaded successfully';
            DOM.mdUrlErrorBar.className = 'md-url-error-bar success';
            DOM.mdUrlErrorBar.hidden = false;
            appState.mdUrlSuccessTimer = setTimeout(() => {
              DOM.mdUrlErrorBar.hidden = true;
              DOM.mdUrlErrorBar.textContent = '';
              DOM.mdUrlErrorBar.className = 'md-url-error-bar';
            }, 3000);
        }
      } catch (err) {
        if (DOM.mdUrlErrorBar) {
            DOM.mdUrlErrorBar.className = 'md-url-error-bar';
            DOM.mdUrlErrorBar.textContent = err.message;
            DOM.mdUrlErrorBar.hidden = false;
        }
      } finally {
        DOM.mdUrlFetchBtn.disabled = false;
        DOM.mdUrlFetchBtn.querySelector('.md-url-fetch-text').hidden = false;
        DOM.mdUrlFetchBtn.querySelector('.md-url-fetch-loader').hidden = true;
      }
    });
  }

  // Copy buttons
  if (DOM.copyBtn) {
    DOM.copyBtn.addEventListener('click', async () => {
      const md = DOM.markdownInput?.value.trim();
      if (!md) return;

      const html = buildMediumHtml(md);
      let success = false;

      try {
        await navigator.clipboard.write([
          new ClipboardItem({
            'text/html': new Blob([html], { type: 'text/html' }),
            'text/plain': new Blob([md], { type: 'text/plain' }),
          }),
        ]);
        success = true;
      } catch (_) {
        try {
          const clone = document.createElement('div');
          clone.className = 'medium-preview';
          clone.innerHTML = html;
          clone.style.cssText = 'position:fixed;top:-9999px;left:-9999px;white-space:pre-wrap';
          document.body.appendChild(clone);
          const range = document.createRange();
          range.selectNodeContents(clone);
          const sel = window.getSelection();
          sel.removeAllRanges();
          sel.addRange(range);
          success = document.execCommand('copy');
          sel.removeAllRanges();
          document.body.removeChild(clone);
        } catch (_) {}
      }

      DOM.copyBtn.textContent = success ? 'Copied!' : 'Failed!';
      DOM.copyBtn.style.pointerEvents = 'none';
      setTimeout(() => {
        DOM.copyBtn.textContent = 'Copy';
        DOM.copyBtn.style.pointerEvents = '';
      }, 2000);
    });
  }

  if (DOM.m2mdCopyBtn) {
    DOM.m2mdCopyBtn.addEventListener('click', async () => {
      if (!appState.currentMarkdownContent) return;

      let success = false;
      try {
        await navigator.clipboard.writeText(appState.currentMarkdownContent);
        success = true;
      } catch (_) {
        try {
          const ta = document.createElement('textarea');
          ta.value = appState.currentMarkdownContent;
          ta.style.cssText = 'position:fixed;opacity:0;pointer-events:none';
          document.body.appendChild(ta);
          ta.select();
          success = document.execCommand('copy');
          document.body.removeChild(ta);
        } catch (_) {}
      }

      DOM.m2mdCopyBtn.textContent = success ? 'Copied!' : 'Failed!';
      DOM.m2mdCopyBtn.style.pointerEvents = 'none';
      setTimeout(() => {
        DOM.m2mdCopyBtn.textContent = 'Copy';
        DOM.m2mdCopyBtn.style.pointerEvents = '';
      }, 2000);
    });
  }

  // IDE Editor Hotkeys (VS Code style)
  if (DOM.markdownInput) {
    DOM.markdownInput.addEventListener('keydown', (e) => {
      const start = DOM.markdownInput.selectionStart;
      const end = DOM.markdownInput.selectionEnd;
      const selectedText = DOM.markdownInput.value.substring(start, end);
      const isMac = navigator.platform.toUpperCase().indexOf('MAC') >= 0;
      const cmdOrCtrl = isMac ? e.metaKey : e.ctrlKey;

      const insertText = (text, newCursorPos = null, newSelectionEnd = null) => {
        e.preventDefault();
        document.execCommand('insertText', false, text);
        if (newCursorPos !== null) {
          DOM.markdownInput.selectionStart = newCursorPos;
          DOM.markdownInput.selectionEnd = newSelectionEnd !== null ? newSelectionEnd : newCursorPos;
        }
        renderPreview();
      };

      const getLineIndices = (text, col) => {
        let lineStart = text.lastIndexOf('\n', col - 1) + 1;
        let lineEnd = text.indexOf('\n', col);
        if (lineEnd === -1) lineEnd = text.length;
        return { lineStart, lineEnd };
      };

      if (e.key === 'Tab' && !e.shiftKey && !e.ctrlKey && !e.altKey && !e.metaKey) {
        insertText('  ', start + 2);
        return;
      }

      if (cmdOrCtrl && !e.shiftKey && !e.altKey) {
        const key = e.key.toLowerCase();
        if (key === 'b') { 
          const isBold = selectedText.startsWith('**') && selectedText.endsWith('**');
          if (isBold) {
            insertText(selectedText.slice(2, -2), start, end - 4);
          } else {
            insertText(`**${selectedText}**`, start + 2, end + 2);
          }
          return;
        }
        if (key === 'i') { 
          const isItalic = selectedText.startsWith('*') && selectedText.endsWith('*') && !selectedText.startsWith('**');
          if (isItalic) {
            insertText(selectedText.slice(1, -1), start, end - 2);
          } else {
            insertText(`*${selectedText}*`, start + 1, end + 1);
          }
          return;
        }
        if (key === 'k') { 
          insertText(`[${selectedText}]()`, start + selectedText.length + 3);
          return;
        }
        if (key === '/') { 
          const { lineStart, lineEnd } = getLineIndices(DOM.markdownInput.value, start);
          const activeStart = selectedText ? start : lineStart;
          const activeEnd = selectedText ? end : lineEnd;
          const activeText = DOM.markdownInput.value.substring(activeStart, activeEnd);
          
          DOM.markdownInput.selectionStart = activeStart;
          DOM.markdownInput.selectionEnd = activeEnd;
          
          if (activeText.startsWith('<!--') && activeText.endsWith('-->')) {
            insertText(activeText.slice(4, -3).trim(), activeStart, activeStart + activeText.length - 7);
          } else {
            insertText(`<!-- ${activeText} -->`, activeStart, activeStart + activeText.length + 9);
          }
          return;
        }
      }

      if (e.altKey && !cmdOrCtrl && !e.shiftKey) {
        if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
          const { lineStart, lineEnd } = getLineIndices(DOM.markdownInput.value, start);
          const isUp = e.key === 'ArrowUp';
          
          if (isUp && lineStart > 0) {
            const prevLineInfo = getLineIndices(DOM.markdownInput.value, lineStart - 2);
            const thisLine = DOM.markdownInput.value.substring(lineStart, lineEnd);
            const prevLine = DOM.markdownInput.value.substring(prevLineInfo.lineStart, prevLineInfo.lineEnd);
            
            DOM.markdownInput.selectionStart = prevLineInfo.lineStart;
            DOM.markdownInput.selectionEnd = lineEnd;
            insertText(`${thisLine}\n${prevLine}`, prevLineInfo.lineStart + (start - lineStart));
            return;
          }
          if (!isUp && lineEnd < DOM.markdownInput.value.length) {
            const nextLineInfo = getLineIndices(DOM.markdownInput.value, lineEnd + 1);
            const thisLine = DOM.markdownInput.value.substring(lineStart, lineEnd);
            const nextLine = DOM.markdownInput.value.substring(nextLineInfo.lineStart, nextLineInfo.lineEnd);
            
            DOM.markdownInput.selectionStart = lineStart;
            DOM.markdownInput.selectionEnd = nextLineInfo.lineEnd;
            insertText(`${nextLine}\n${thisLine}`, lineStart + nextLine.length + 1 + (start - lineStart));
            return;
          }
        }
      }

      if (!cmdOrCtrl && !e.altKey) {
        const pairs = { '(': ')', '[': ']', '{': '}', '<': '>', '"': '"', "'": "'", '`': '`' };
        const closingPairs = { ')': true, ']': true, '}': true, '>': true, '"': true, "'": true, '`': true };
        const nextChar = DOM.markdownInput.value.charAt(start);
        const prevChar = DOM.markdownInput.value.charAt(start - 1);

        if (e.key === 'Backspace' && start === end && pairs[prevChar] && pairs[prevChar] === nextChar) {
          DOM.markdownInput.selectionStart = start - 1;
          DOM.markdownInput.selectionEnd = start + 1;
          insertText('', start - 1, start - 1);
          return;
        }

        if (selectedText.length > 0 && pairs[e.key]) {
          insertText(`${e.key}${selectedText}${pairs[e.key]}`, start + 1, end + 1);
          return;
        }

        if (selectedText.length === 0 && pairs[e.key]) {
          if (e.key === nextChar && closingPairs[e.key]) {
            e.preventDefault();
            DOM.markdownInput.selectionStart = DOM.markdownInput.selectionEnd = start + 1;
          } else {
            insertText(`${e.key}${pairs[e.key]}`, start + 1, start + 1);
          }
          return;
        }

        if (selectedText.length === 0 && closingPairs[e.key] && nextChar === e.key) {
          e.preventDefault();
          DOM.markdownInput.selectionStart = DOM.markdownInput.selectionEnd = start + 1;
          return;
        }
      }
    });
  }
}

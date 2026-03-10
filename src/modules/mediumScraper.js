import JSZip from 'jszip';
import { DOM } from './dom.js';
import { appState } from './state.js';
import { marked, stripFrontMatter, updateWordCharStats } from './markdownEngine.js';

function setLoading(loading) {
  if (!DOM.convertBtn || !DOM.urlInput) return;
  const btnText = DOM.convertBtn.querySelector('.btn-text');
  const btnLoader = DOM.convertBtn.querySelector('.btn-loader');

  if (loading) {
    if (btnText) btnText.hidden = true;
    if (btnLoader) btnLoader.hidden = false;
    DOM.convertBtn.disabled = true;
    DOM.urlInput.disabled = true;
    if (DOM.bypassCacheCheckbox) DOM.bypassCacheCheckbox.disabled = true;
  } else {
    if (btnText) btnText.hidden = false;
    if (btnLoader) btnLoader.hidden = true;
    DOM.convertBtn.disabled = false;
    DOM.urlInput.disabled = false;
    if (DOM.bypassCacheCheckbox) DOM.bypassCacheCheckbox.disabled = false;
  }
}

function showProgress(percent, text) {
  if (!DOM.progressSection) return;
  DOM.progressSection.hidden = false;
  DOM.progressFill.style.width = `${percent}%`;
  DOM.progressText.textContent = text;
}

function hideProgress() {
  if (!DOM.progressSection) return;
  DOM.progressSection.hidden = true;
  DOM.progressFill.style.width = '0%';
}

function showError(message) {
  if (!DOM.errorMessage) return;
  DOM.errorMessage.hidden = false;
  DOM.errorText.textContent = message;
}

function hideError() {
  if (!DOM.errorMessage) return;
  DOM.errorMessage.hidden = true;
}

function showDownload() {
  if (DOM.downloadSection) DOM.downloadSection.hidden = false;
}

function hideDownload() {
  if (DOM.downloadSection) DOM.downloadSection.hidden = true;
}

function addM2mdCopyImageButtons(container) {
  const images = container.querySelectorAll('.medium-preview img');
  images.forEach((img) => {
    if (img.parentElement?.classList.contains('m2md-image-wrapper')) return;

    const wrapper = document.createElement('div');
    wrapper.className = 'm2md-image-wrapper';

    const copyImgBtn = document.createElement('button');
    copyImgBtn.className = 'm2md-image-copy';
    copyImgBtn.type = 'button';
    copyImgBtn.title = 'Copy image to clipboard';
    copyImgBtn.textContent = 'Copy Image';

    copyImgBtn.addEventListener('click', async () => {
      try {
        const resp = await fetch(img.src);
        const blob = await resp.blob();
        const pngBlob = blob.type === 'image/png'
          ? blob
          : await new Promise((resolve) => {
              const canvas = document.createElement('canvas');
              const tempImg = new Image();
              tempImg.onload = () => {
                canvas.width = tempImg.naturalWidth;
                canvas.height = tempImg.naturalHeight;
                canvas.getContext('2d').drawImage(tempImg, 0, 0);
                canvas.toBlob((b) => resolve(b), 'image/png');
              };
              tempImg.src = img.src;
            });
        await navigator.clipboard.write([
          new ClipboardItem({ 'image/png': pngBlob }),
        ]);
        copyImgBtn.textContent = '✓ Copied!';
        copyImgBtn.classList.add('copied');
      } catch (err) {
        copyImgBtn.textContent = '✗ Failed';
        copyImgBtn.classList.add('failed');
      }
      setTimeout(() => {
        copyImgBtn.textContent = 'Copy Image';
        copyImgBtn.classList.remove('copied', 'failed');
      }, 2000);
    });

    img.parentNode.insertBefore(wrapper, img);
    wrapper.appendChild(img);
    wrapper.appendChild(copyImgBtn);
  });
}

function flashDownloadSuccess() {
  if (!DOM.downloadBtn) return;
  const originalHTML = DOM.downloadBtn.innerHTML;
  DOM.downloadBtn.innerHTML = `
    <svg width="13" height="13" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
      <path d="M13.78 4.22a.75.75 0 010 1.06l-7.25 7.25a.75.75 0 01-1.06 0L2.22 9.28a.75.75 0 011.06-1.06L6 10.94l6.72-6.72a.75.75 0 011.06 0z"/>
    </svg>
    Saved!`;
  DOM.downloadBtn.disabled = true;
  setTimeout(() => {
    DOM.downloadBtn.innerHTML = originalHTML;
    DOM.downloadBtn.disabled = false;
  }, 2500);
}

export function setupMediumScraper() {
  if (DOM.urlForm) {
    DOM.urlForm.addEventListener('submit', async (e) => {
      e.preventDefault();

      let url = DOM.urlInput.value.trim();
      if (!url) return;

      if (DOM.bypassCacheCheckbox && DOM.bypassCacheCheckbox.checked) {
        const sep = url.includes('?') ? '&' : '?';
        url += `${sep}refresh=${Date.now()}`;
      }

      hideError();
      hideDownload();
      setLoading(true);
      if (DOM.m2mdExportHtmlBtn) DOM.m2mdExportHtmlBtn.disabled = true;
      if (DOM.m2mdExportPdfBtn) DOM.m2mdExportPdfBtn.disabled = true;

      showProgress(10, 'Fetching article...');

      const progressInterval = setInterval(() => {
        const current = parseFloat(DOM.progressFill.style.width) || 10;
        if (current < 85) {
          const next = current + Math.random() * 8;
          const messages = [
            'Extracting content...',
            'Converting to Markdown...',
            'Downloading images...',
            'Packaging ZIP...',
          ];
          const msgIndex = Math.min(Math.floor(next / 25), messages.length - 1);
          showProgress(next, messages[msgIndex]);
        }
      }, 800);

      try {
        let response = await fetch('/api/convert-url', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ url }),
        });

        if (!response.ok) {
          const errData = await response.json().catch(() => ({}));

          if (errData.fallback === 'client-fetch') {
            showProgress(30, 'Server blocked — trying client-side proxy...');
            const proxyMirrors = ['https://freedium-mirror.cfd', 'https://freedium.cfd'];
            let clientHtml = null;

            for (const mirror of proxyMirrors) {
              try {
                showProgress(40, `Trying ${mirror.split('//')[1]}...`);
                const proxyResp = await fetch(`${mirror}/${url}`, { headers: { Accept: 'text/html' } });
                if (proxyResp.ok) {
                  clientHtml = await proxyResp.text();
                  break;
                }
              } catch (proxyErr) {}
            }

            if (!clientHtml) {
              throw new Error('Could not fetch the article. Medium blocked access.');
            }

            showProgress(60, 'Converting fetched content...');
            response = await fetch('/api/convert-html', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ html: clientHtml, sourceUrl: url }),
            });

            if (!response.ok) {
              const data2 = await response.json().catch(() => ({}));
              throw new Error(data2.error || `Conversion error: ${response.status}`);
            }
          } else {
            throw new Error(errData.error || `Server error: ${response.status}`);
          }
        }

        clearInterval(progressInterval);
        hideError();
        showProgress(95, 'Preparing download...');

        const data = await response.json();

        if (data.markdown) {
          for (const blobUrl of appState.previewBlobUrls) URL.revokeObjectURL(blobUrl);
          appState.previewBlobUrls = [];

          appState.currentMarkdownContent = data.markdown;
          if (DOM.m2mdCopyBtn) DOM.m2mdCopyBtn.disabled = false;
          if (DOM.m2mdExportHtmlBtn) DOM.m2mdExportHtmlBtn.disabled = false;
          if (DOM.m2mdExportPdfBtn) DOM.m2mdExportPdfBtn.disabled = false;
          const renderedHtml = marked.parse(stripFrontMatter(appState.currentMarkdownContent));
          DOM.m2mdPreviewContent.innerHTML = `<div class="medium-preview">${renderedHtml}</div>`;
          updateWordCharStats(DOM.m2mdPreviewContent.innerText || '', 'm2md-preview-stats');

          if (data.zipBase64) {
            try {
              showProgress(95, 'Unpacking ZIP archive...');
              const zip = await JSZip.loadAsync(data.zipBase64, { base64: true });
              const imgElements = [...DOM.m2mdPreviewContent.querySelectorAll('img')].filter((img) => {
                const src = img.getAttribute('src') || '';
                return src.replace(/^\.\//, '').startsWith('images/');
              });

              const total = imgElements.length;
              if (total > 0) showProgress(95, total === 1 ? 'Loading 1 image...' : `Loading ${total} images...`);

              let loaded = 0;
              for (const img of imgElements) {
                const normalizedSrc = (img.getAttribute('src') || '').replace(/^\.\//, '');
                const escapedSrc = normalizedSrc.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                const files = zip.file(new RegExp(escapedSrc + '$'));
                if (files && files.length > 0) {
                  const u8 = await files[0].async('uint8array');
                  const ext = normalizedSrc.split('.').pop().toLowerCase();
                  const mimeTypes = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif', svg: 'image/svg+xml', webp: 'image/webp' };
                  const type = mimeTypes[ext] || 'application/octet-stream';
                  const blobUrl = URL.createObjectURL(new Blob([u8], { type }));
                  appState.previewBlobUrls.push(blobUrl);
                  img.src = blobUrl;
                }
                loaded++;
                if (total > 1) showProgress(95, `Loading images (${loaded} of ${total})...`);
              }
              addM2mdCopyImageButtons(DOM.m2mdPreviewContent);
            } catch (zipErr) {}
          }
          if (!data.zipBase64) {
            addM2mdCopyImageButtons(DOM.m2mdPreviewContent);
          }
        }

        appState.currentZipToken = data.zipToken || null;
        appState.currentZipBase64 = data.zipBase64 || null;
        appState.currentArticleName = data.slug || 'article';

        showProgress(100, 'Complete!');
        setLoading(false);

        setTimeout(() => {
          hideProgress();
          showDownload();
        }, 400);
      } catch (err) {
        clearInterval(progressInterval);
        hideProgress();
        showError(err.message);
        setLoading(false);
      }
    });
  }

  if (DOM.downloadBtn) {
    DOM.downloadBtn.addEventListener('click', async () => {
      if (!appState.currentZipBase64 && !appState.currentZipToken) return;

      if (window.showSaveFilePicker) {
        try {
          const fileHandle = await window.showSaveFilePicker({
            suggestedName: `${appState.currentArticleName}.zip`,
            types: [{ description: 'ZIP Archive', accept: { 'application/zip': ['.zip'] } }],
          });

          if (appState.currentZipBase64) {
            const binary = atob(appState.currentZipBase64);
            const bytes = new Uint8Array(binary.length);
            for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
            const blob = new Blob([bytes], { type: 'application/zip' });
            const writable = await fileHandle.createWritable();
            await writable.write(blob);
            await writable.close();
            flashDownloadSuccess();
            return;
          }
        } catch (err) {
          if (err.name === 'AbortError') return;
        }
      }

      if (appState.currentZipToken) {
        const tokenToUse = appState.currentZipToken;
        appState.currentZipToken = null;
        const a = document.createElement('a');
        a.href = `/api/download-zip/${tokenToUse}`;
        a.download = `${appState.currentArticleName}.zip`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        flashDownloadSuccess();
        return;
      }

      if (appState.currentZipBase64) {
        const binary = atob(appState.currentZipBase64);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
        const blob = new Blob([bytes], { type: 'application/zip' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${appState.currentArticleName}.zip`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        setTimeout(() => URL.revokeObjectURL(url), 60_000);
        flashDownloadSuccess();
      }
    });
  }
}

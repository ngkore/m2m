import html2canvas from 'html2canvas';
import { jsPDF } from 'jspdf';
import { DOM } from './dom.js';
import { appState } from './state.js';

function buildExportDocument(htmlBody, title) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${title}</title>
<style>
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    font-size: 16px;
    line-height: 1.75;
    color: #1a1a1a;
    background: #ffffff;
    max-width: 740px;
    margin: 48px auto;
    padding: 0 24px 80px;
  }
  h1,h2,h3,h4,h5,h6 { font-weight: 700; line-height: 1.25; margin: 1.5em 0 0.5em; }
  h1 { font-size: 2rem; }
  h2 { font-size: 1.5rem; }
  h3 { font-size: 1.25rem; }
  p  { margin: 1em 0; }
  a  { color: #2563eb; text-decoration: underline; }
  img { max-width: 100%; height: auto; border-radius: 4px; margin: 1em 0; display: block; }
  pre { background: #171717; color: #e0e0e0; border-radius: 5px; padding: 16px; overflow-x: auto; font-size: 0.875rem; margin: 1.25em 0; }
  code { font-family: "JetBrains Mono", "Fira Code", monospace; font-size: 0.875em; background: #f0f4ff; color: #1e40af; border: 1px solid #bfdbfe; border-radius: 3px; padding: 2px 5px; }
  pre code { background: transparent; border: none; color: inherit; padding: 0; font-size: inherit; }
  blockquote { border-left: 2px solid #2563eb; padding: 8px 24px; margin: 1.5em 0; color: #555; font-style: italic; }
  ul, ol { margin: 1em 0; padding-left: 1.75em; }
  li { margin: 0.25em 0; }
  table { width: 100%; border-collapse: collapse; margin: 1.25em 0; }
  th, td { border: 1px solid #e2e2e2; padding: 8px 12px; text-align: left; }
  th { background: #f6f6f6; font-weight: 600; }
  hr { border: none; border-top: 1px solid #e2e2e2; margin: 2em 0; }
  @media print { body { margin: 0; max-width: 100%; } }
</style>
</head>
<body>${htmlBody}</body>
</html>`;
}

function downloadHtml(htmlContent, filename) {
  const blob = new Blob([htmlContent], { type: 'text/html;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

async function fallbackPdfDownload(pdf, filename) {
  try {
    const dataUri = pdf.output('datauristring');
    const base64Str = dataUri.split(',')[1];
    const res = await fetch('/api/upload-pdf', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ base64Data: base64Str, filename })
    });
    if (!res.ok) throw new Error('Server returned ' + res.status);
    const { token } = await res.json();
    if (token) {
      const a = document.createElement('a');
      a.href = `/api/download-pdf/${token}`;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    } else {
      pdf.save(filename);
    }
  } catch (err) {
    console.warn('PDF upload fallback failed:', err);
    pdf.save(filename);
  }
}

async function exportToPdf(paneEl, filename, btnEl) {
  const inner = paneEl.querySelector('.medium-preview');
  if (!inner) return;

  const originalText = btnEl.textContent;
  btnEl.textContent = '...';
  btnEl.disabled = true;

  const A4_PX       = 794;
  const A4_H_PX     = 1123;
  const MARGIN_PX   = 96;
  const CONTENT_W   = A4_PX - MARGIN_PX * 2;
  const CONTENT_H   = A4_H_PX - MARGIN_PX * 2;
  const SCALE       = 2;

  const A4_W_MM     = 210;
  const A4_H_MM     = 297;
  const MARGIN_MM   = 25.4;
  const CONTENT_W_MM = A4_W_MM - MARGIN_MM * 2;
  const CONTENT_H_MM = A4_H_MM - MARGIN_MM * 2;

  const isDark    = document.documentElement.dataset.theme === 'dark';
  const bgColor   = isDark ? '#141414' : '#ffffff';
  const textColor = isDark ? '#ededed' : '#1a1a1a';

  const cs = getComputedStyle(document.documentElement);
  const resolve = (v) => cs.getPropertyValue(v).trim();

  const SCOPE = 'pdf-export-offscreen';
  const wrap = document.createElement('div');
  wrap.className = SCOPE;
  wrap.style.cssText = `
    position: fixed; left: -9999px; top: 0;
    width: ${CONTENT_W}px;
    background: ${bgColor};
    color: ${textColor};
    box-sizing: border-box;
    font-family: "ABeeZee", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    font-size: 15px;
    line-height: 1.75;
  `;

  const S = `.${SCOPE}`;
  const styleEl = document.createElement('style');
  styleEl.textContent = `
    ${S} h1 { font-family: "ABeeZee", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; font-size: 2rem; font-weight: 700; letter-spacing: -0.02em; line-height: 1.2; margin: 0 0 ${resolve('--s6') || '24px'} 0; color: ${resolve('--text-primary') || textColor}; }
    ${S} h2 { font-family: "ABeeZee", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; font-size: 1.4375rem; font-weight: 700; letter-spacing: -0.01em; line-height: 1.3; margin: ${resolve('--s8') || '48px'} 0 ${resolve('--s4') || '16px'} 0; color: ${resolve('--text-primary') || textColor}; }
    ${S} h3 { font-family: "ABeeZee", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; font-size: 1.125rem; font-weight: 700; line-height: 1.4; margin: ${resolve('--s6') || '24px'} 0 ${resolve('--s3') || '12px'} 0; color: ${resolve('--text-primary') || textColor}; }
    ${S} h4, ${S} h5, ${S} h6 { font-family: "ABeeZee", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; font-weight: 700; line-height: 1.4; margin: ${resolve('--s5') || '20px'} 0 ${resolve('--s2') || '8px'} 0; color: ${resolve('--text-primary') || textColor}; }
    ${S} p { font-family: "ABeeZee", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; font-size: 1rem; line-height: 1.85; margin: 0 0 ${resolve('--s5') || '20px'} 0; color: ${resolve('--text-secondary') || textColor}; }
    ${S} a { color: ${resolve('--accent') || '#2563EB'}; text-decoration: underline; }
    ${S} strong { font-weight: 700; color: ${resolve('--text-primary') || textColor}; }
    ${S} em { font-style: italic; color: ${resolve('--text-secondary') || textColor}; }
    ${S} blockquote { border-left: 2px solid ${resolve('--accent') || '#2563EB'}; padding: ${resolve('--s3') || '12px'} ${resolve('--s6') || '24px'}; margin: ${resolve('--s6') || '24px'} 0; color: ${resolve('--text-muted') || '#6e6e6e'}; font-style: italic; background: ${isDark ? 'rgba(59,130,246,0.07)' : 'rgba(37,99,235,0.04)'}; border-radius: 0 ${resolve('--r-sm') || '3px'} ${resolve('--r-sm') || '3px'} 0; }
    ${S} code { font-family: "JetBrains Mono", "Fira Code", monospace; font-size: 0.82em; padding: 2px 6px; background: ${isDark ? '#1e3a5f' : '#eff6ff'}; color: ${isDark ? '#93c5fd' : '#1e40af'}; border: 1px solid ${isDark ? '#2d5a8e' : '#bfdbfe'}; border-radius: ${resolve('--r-sm') || '3px'}; display: inline-block; max-width: 100%; word-break: break-word; white-space: pre-wrap; }
    ${S} pre { background: ${isDark ? '#0a0a0a' : '#171717'} !important; color: #e0e0e0 !important; border: 1px solid ${isDark ? '#1e1e1e' : '#2c2c2c'}; border-radius: ${resolve('--r-md') || '5px'} !important; margin: ${resolve('--s6') || '24px'} 0 !important; overflow: hidden !important; white-space: pre-wrap !important; word-break: break-all !important; }
    ${S} pre code { display: block; padding: ${resolve('--s5') || '20px'} ${resolve('--s6') || '24px'} !important; background: transparent !important; color: inherit !important; border: none !important; border-radius: 0 !important; font-size: 0.8125rem !important; line-height: 1.7 !important; }
    ${S} ul, ${S} ol { padding-left: 0; margin: 0 0 ${resolve('--s5') || '20px'} 0; list-style: none; }
    ${S} li { display: flex; align-items: baseline; margin-bottom: ${resolve('--s2') || '8px'}; color: ${resolve('--text-secondary') || textColor}; font-size: 1rem; line-height: 1.8; padding-left: 0.4em; }
    ${S} .pdf-list-marker { flex-shrink: 0; width: 1.6em; text-align: left; user-select: none; color: ${resolve('--text-secondary') || textColor}; }
    ${S} .pdf-list-content { flex: 1; min-width: 0; }
    ${S} img { max-width: 100%; height: auto; border-radius: ${resolve('--r-md') || '5px'}; margin: ${resolve('--s6') || '24px'} 0; border: 1px solid ${resolve('--border') || '#e2e2e2'}; display: block; }
    ${S} hr { border: none; height: 1px; background: ${resolve('--border') || '#e2e2e2'}; margin: ${resolve('--s8') || '48px'} 0; }
    ${S} table { width: 100%; border-collapse: collapse; margin: ${resolve('--s6') || '24px'} 0; font-size: 0.9375rem; }
    ${S} th, ${S} td { padding: ${resolve('--s2') || '8px'} ${resolve('--s4') || '16px'}; border: 1px solid ${resolve('--border') || '#e2e2e2'}; text-align: left; }
    ${S} th { background: ${resolve('--bg-subtle') || '#efefef'}; font-weight: 700; color: ${resolve('--text-primary') || textColor}; font-size: 0.75rem; text-transform: uppercase; letter-spacing: 0.07em; }
    ${S} td { color: ${resolve('--text-secondary') || textColor}; }
    ${S} .table-image-wrapper { display: block; margin: ${resolve('--s6') || '24px'} 0; max-width: 100%; }
    ${S} .table-image-wrapper img { margin: 0; border-radius: ${resolve('--r-sm') || '3px'}; }
    ${S} .table-image-badge, ${S} .table-image-copy, ${S} .m2md-image-copy { display: none !important; }
    ${S} .hljs { background: transparent !important; }
  `;
  wrap.appendChild(styleEl);

  const clone = inner.cloneNode(true);
  clone.style.cssText = 'width:100%;max-width:100%;margin:0;padding:0;';

  function injectListMarkers(container) {
    container.querySelectorAll('ol').forEach((ol) => {
      let counter = parseInt(ol.getAttribute('start') || '1', 10);
      ol.querySelectorAll(':scope > li').forEach((li) => {
        wrapLiContent(li, `${counter}.`);
        counter++;
      });
    });

    container.querySelectorAll('ul').forEach((ul) => {
      let depth = 0;
      let curr = ul;
      while (curr && curr !== container) {
        if (curr.tagName === 'UL') depth++;
        curr = curr.parentElement;
      }

      let markerText = '•';
      if (depth === 2) markerText = '◦';
      if (depth >= 3) markerText = '▪';

      ul.querySelectorAll(':scope > li').forEach((li) => {
        if (!li.querySelector('.pdf-list-marker')) {
          wrapLiContent(li, markerText);
        }
      });
    });
  }

  function wrapLiContent(li, markerText) {
    const marker = document.createElement('span');
    marker.className = 'pdf-list-marker';
    marker.textContent = markerText;

    const content = document.createElement('span');
    content.className = 'pdf-list-content';

    while (li.firstChild) {
      content.appendChild(li.firstChild);
    }

    li.appendChild(marker);
    li.appendChild(content);
  }

  injectListMarkers(clone);
  wrap.appendChild(clone);
  document.body.appendChild(wrap);

  try {
    const cloneRect = clone.getBoundingClientRect();
    const elementsToMeasure = [];

    function extractAtoms(node) {
      if (node.nodeType !== Node.ELEMENT_NODE) return;

      const structuralSelectors = 'p, li, blockquote, tr, h1, h2, h3, h4, h5, h6, img, hr, .m2md-image-wrapper, .table-image-wrapper';
      const isStructural = node.matches && node.matches(structuralSelectors);

      // If it is a structural block, verify if it contains NESTED structural blocks.
      if (isStructural) {
        const innerBlocks = node.querySelectorAll(structuralSelectors);
        if (innerBlocks.length === 0) {
          // Leaf structural block (e.g. <p>, <h1>, or a tight <li> without nested lists)
          const rect = node.getBoundingClientRect();
          if (rect.height > 0) {
            elementsToMeasure.push({
              top: rect.top - cloneRect.top,
              bottom: rect.bottom - cloneRect.top,
              height: rect.height,
              node: node // For debugging
            });
          }
          return; // Do not recurse into inline children (span, strong, code, etc.)
        }
      }

      // If it's not structural (e.g. <div>, <pre>), or it has nested blocks (e.g. loose <li> containing <ul>),
      // we must recurse to find the true leaf blocks, or extract text fragments directly.
      for (const child of Array.from(node.childNodes)) {
        if (child.nodeType === Node.TEXT_NODE && child.textContent.trim().length > 0) {
           // We have bare text directly mixed with blocks (or inside <pre>). We must map every visual line segment accurately.
           const range = document.createRange();
           range.selectNodeContents(child);
           const rects = Array.from(range.getClientRects());
           for (const rect of rects) {
              if (rect.height > 0) {
                 elementsToMeasure.push({
                    top: rect.top - cloneRect.top,
                    bottom: rect.bottom - cloneRect.top,
                    height: rect.height
                 });
              }
           }
        } else if (child.nodeType === Node.ELEMENT_NODE) {
           extractAtoms(child);
        }
      }
    }

    extractAtoms(clone);
    const elementBounds = elementsToMeasure.sort((a, b) => a.top - b.top);

    const pageBreaks = [0];
    let pageBottom = CONTENT_H;

    for (const bounds of elementBounds) {
      if (bounds.top >= pageBottom) {
        pageBreaks.push(pageBottom);
        pageBottom += CONTENT_H;
        while (bounds.top >= pageBottom) {
          pageBreaks.push(pageBottom);
          pageBottom += CONTENT_H;
        }
      }

      const driftBuffer = 5; // allow 5px collision margin for float drift
      if (bounds.bottom > pageBottom && (bounds.top + driftBuffer) < pageBottom) {
        if (bounds.height <= CONTENT_H) {
          // Push bounds.top but subtract a tiny buffer to cut into the CSS margin above
          const safeCut = Math.max(0, bounds.top - 2); 
          if (safeCut > pageBreaks[pageBreaks.length - 1]) {
            pageBreaks.push(safeCut);
            pageBottom = safeCut + CONTENT_H;
          }
        } else {
          pageBreaks.push(pageBottom);
          pageBottom += CONTENT_H;
          while (bounds.bottom > pageBottom) {
            pageBreaks.push(pageBottom);
            pageBottom += CONTENT_H;
          }
        }
      }
    }

    const totalH = clone.scrollHeight;

    const canvas = await html2canvas(wrap, {
      scale: SCALE,
      useCORS: true,
      allowTaint: true,
      logging: false,
      backgroundColor: bgColor,
      width: CONTENT_W,
      height: totalH,
    });

    const linkAnnotations = [];
    clone.querySelectorAll('a[href]').forEach((a) => {
      const href = a.getAttribute('href');
      if (!href || href.startsWith('#') || href.startsWith('javascript:')) return;
      const rect = a.getBoundingClientRect();
      const wrapRect = clone.getBoundingClientRect();
      linkAnnotations.push({
        href,
        top: rect.top - wrapRect.top,
        left: rect.left - wrapRect.left,
        width: rect.width,
        height: rect.height,
      });
    });

    document.body.removeChild(wrap);

    const pdf = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait' });
    const pxToMm = CONTENT_W_MM / CONTENT_W;

    for (let i = 0; i < pageBreaks.length; i++) {
      const sliceTopPx = pageBreaks[i];
      const sliceBottomPx = (i + 1 < pageBreaks.length) ? pageBreaks[i + 1] : totalH;
      const sliceHeightPx = sliceBottomPx - sliceTopPx;
      if (sliceHeightPx <= 0) continue;

      const srcY = Math.round(sliceTopPx * SCALE);
      const srcH = Math.round(sliceHeightPx * SCALE);
      const srcW = canvas.width;

      const pageCanvas = document.createElement('canvas');
      pageCanvas.width = srcW;
      pageCanvas.height = srcH;
      const ctx = pageCanvas.getContext('2d');

      ctx.fillStyle = bgColor;
      ctx.fillRect(0, 0, srcW, srcH);
      ctx.drawImage(canvas, 0, srcY, srcW, srcH, 0, 0, srcW, srcH);

      const pageImgData = pageCanvas.toDataURL('image/jpeg', 0.92);
      const imgW_mm = CONTENT_W_MM;
      const imgH_mm = sliceHeightPx * pxToMm;

      if (i > 0) pdf.addPage();
      pdf.addImage(pageImgData, 'JPEG', MARGIN_MM, MARGIN_MM, imgW_mm, imgH_mm);

      for (const link of linkAnnotations) {
        const linkTop = link.top;
        const linkBottom = link.top + link.height;
        if (linkBottom > sliceTopPx && linkTop < sliceBottomPx) {
          const relTop = Math.max(linkTop - sliceTopPx, 0);
          const relBottom = Math.min(linkBottom - sliceTopPx, sliceHeightPx);
          const xMm = MARGIN_MM + link.left * pxToMm;
          const yMm = MARGIN_MM + relTop * pxToMm;
          const wMm = link.width * pxToMm;
          const hMm = (relBottom - relTop) * pxToMm;
          pdf.link(xMm, yMm, wMm, hMm, { url: link.href });
        }
      }
    }

    if (window.showSaveFilePicker) {
      try {
        const fileHandle = await window.showSaveFilePicker({
          suggestedName: filename,
          types: [{ description: 'PDF Document', accept: { 'application/pdf': ['.pdf'] } }],
        });
        const pdfBlob = pdf.output('blob');
        const writable = await fileHandle.createWritable();
        await writable.write(pdfBlob);
        await writable.close();
      } catch (saveErr) {
        if (saveErr.name === 'AbortError') return;
        await fallbackPdfDownload(pdf, filename);
      }
    } else {
      await fallbackPdfDownload(pdf, filename);
    }
  } catch (err) {
    if (document.body.contains(wrap)) document.body.removeChild(wrap);
    console.error('PDF export failed:', err);
    alert('PDF export failed: ' + err.message);
  } finally {
    btnEl.textContent = originalText;
    btnEl.disabled = false;
  }
}

export function setupExportButtons() {
  if (DOM.exportHtmlBtn) {
    DOM.exportHtmlBtn.addEventListener('click', () => {
      const inner = DOM.previewContent.querySelector('.medium-preview');
      if (!inner) return;
      const doc = buildExportDocument(inner.innerHTML, 'Medium Preview');
      downloadHtml(doc, 'medium-preview.html');
    });
  }

  if (DOM.exportPdfBtn) {
    DOM.exportPdfBtn.addEventListener('click', () => {
      exportToPdf(DOM.previewContent, 'medium-preview.pdf', DOM.exportPdfBtn);
    });
  }

  if (DOM.m2mdExportHtmlBtn) {
    DOM.m2mdExportHtmlBtn.addEventListener('click', () => {
      const inner = DOM.m2mdPreviewContent.querySelector('.medium-preview');
      if (!inner) return;
      const clone = inner.cloneNode(true);
      clone.querySelectorAll('.m2md-image-copy').forEach((el) => el.remove());
      const articleName = appState.currentArticleName || 'article';
      const doc = buildExportDocument(clone.innerHTML, articleName);
      downloadHtml(doc, `${articleName}.html`);
    });
  }

  if (DOM.m2mdExportPdfBtn) {
    DOM.m2mdExportPdfBtn.addEventListener('click', () => {
      exportToPdf(DOM.m2mdPreviewContent, `${appState.currentArticleName || 'article'}.pdf`, DOM.m2mdExportPdfBtn);
    });
  }
}

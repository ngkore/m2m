import { Marked } from 'marked';
import html2canvas from 'html2canvas';
import { jsPDF } from 'jspdf';
import { markedHighlight } from 'marked-highlight';
import hljs from 'highlight.js';
import 'highlight.js/styles/github-dark.min.css';
import JSZip from 'jszip';

// ───────────────────────────────────────
// Markdown Parser Setup
// ───────────────────────────────────────

const marked = new Marked(
  markedHighlight({
    langPrefix: 'hljs language-',
    highlight(code, lang) {
      if (lang && hljs.getLanguage(lang)) {
        return hljs.highlight(code, { language: lang }).value;
      }
      return hljs.highlightAuto(code).value;
    },
  })
);

marked.setOptions({
  gfm: true,
  breaks: true,
});

// ───────────────────────────────────────
// DOM Elements
// ───────────────────────────────────────

const tabButtons = document.querySelectorAll('.tab-btn');
const tabPanels = document.querySelectorAll('.tab-content');

const markdownInput = document.getElementById('markdown-input');
const previewContent = document.getElementById('preview-content');
const fileInput = document.getElementById('file-input');
const copyBtn = document.getElementById('copy-btn');
const clearBtn = document.getElementById('clear-btn');

const mdUrlForm = document.getElementById('md-url-form');
const mdUrlInput = document.getElementById('md-url-input');
const mdUrlFetchBtn = document.getElementById('md-url-fetch-btn');
const mdUrlErrorBar = document.getElementById('md-url-error');
let mdUrlSuccessTimer = null;

const themeToggle = document.getElementById('theme-toggle');

function setTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  localStorage.setItem('m2m-theme', theme);
}

const savedTheme = localStorage.getItem('m2m-theme') || 'light';
setTheme(savedTheme);

themeToggle.addEventListener('click', () => {
  const current = document.documentElement.getAttribute('data-theme');
  setTheme(current === 'dark' ? 'light' : 'dark');
});

// ───────────────────────────────────────
// Typewriter Animation
// ───────────────────────────────────────

(function initTypewriter() {
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
})();

const urlForm = document.getElementById('url-form');
const urlInput = document.getElementById('url-input');
const bypassCacheCheckbox = document.getElementById('bypass-cache-checkbox');
const convertBtn = document.getElementById('convert-btn');
const progressSection = document.getElementById('progress-section');
const progressFill = document.getElementById('progress-fill');
const progressText = document.getElementById('progress-text');
const errorMessage = document.getElementById('error-message');
const errorText = document.getElementById('error-text');
const downloadSection = document.getElementById('download-section');
const downloadBtn = document.getElementById('download-btn');

let currentZipToken = null;
let currentZipBase64 = null;
let currentArticleName = 'article';
let currentMarkdownContent = '';
let previewBlobUrls = [];

/** Strip YAML front matter from Markdown. */
function stripFrontMatter(markdown) {
  return markdown.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n*/m, '');
}

/** Pre-process Markdown for Medium (task lists, footnotes, admonitions). */
function preprocessForMedium(markdown) {
  let md = stripFrontMatter(markdown);

  // Task lists → Unicode checkboxes
  md = md.replace(/^(\s*[-*+]\s+)\[[ ]\]/gm, '$1☐');
  md = md.replace(/^(\s*[-*+]\s+)\[[xX]\]/gm, '$1☑');


  // Footnotes: collect definitions, replace refs with superscript numbers
  const footnoteDefs = {};
  const footnoteOrder = [];
  md = md.replace(/^\[\^([^\]]+)\]:\s*(.+(?:\n(?!\[\^)[ \t]+.+)*)/gm, (_, label, text) => {
    if (!footnoteDefs[label]) {
      footnoteOrder.push(label);
      footnoteDefs[label] = text.replace(/\n[ \t]+/g, ' ').trim();
    }
    return '';
  });

  let fnCounter = 0;
  const fnIndexMap = {};
  md = md.replace(/\[\^([^\]]+)\]/g, (_, label) => {
    if (!fnIndexMap[label]) {
      fnIndexMap[label] = ++fnCounter;
    }
    return `<sup>${fnIndexMap[label]}</sup>`;
  });

  const orderedLabels = [...footnoteOrder, ...Object.keys(fnIndexMap).filter((l) => !footnoteDefs[l])];
  const fnEntries = orderedLabels
    .filter((l) => fnIndexMap[l] && footnoteDefs[l])
    .map((l) => `${fnIndexMap[l]}. ${footnoteDefs[l]}`);
  if (fnEntries.length > 0) {
    md = md.trimEnd() + '\n\n---\n\n**Footnotes**\n\n' + fnEntries.join('\n\n');
  }


  md = convertAdmonitionsForMedium(md);

  return md;
}

const m2mdPreviewContent = document.getElementById('m2md-preview-content');
const m2mdCopyBtn = document.getElementById('m2md-copy-btn');

const exportHtmlBtn    = document.getElementById('export-html-btn');
const exportPdfBtn     = document.getElementById('export-pdf-btn');
const m2mdExportHtmlBtn = document.getElementById('m2md-export-html-btn');
const m2mdExportPdfBtn  = document.getElementById('m2md-export-pdf-btn');
const reformatBtn = document.getElementById('reformat-btn');

// ───────────────────────────────────────
// Tab Switching
// ───────────────────────────────────────

tabButtons.forEach((btn) => {
  btn.addEventListener('click', () => {
    const targetTab = btn.dataset.tab;

    tabButtons.forEach((b) => {
      b.classList.remove('active');
      b.setAttribute('aria-selected', 'false');
    });
    btn.classList.add('active');
    btn.setAttribute('aria-selected', 'true');

    tabPanels.forEach((panel) => {
      const isActive = panel.id === `panel-${targetTab}`;
      panel.classList.toggle('active', isActive);
      panel.hidden = !isActive;
    });
  });
});

// ───────────────────────────────────────
// Table-to-Image Conversion
// ───────────────────────────────────────

/**
 * Parse a table cell's innerHTML into styled text runs and links.
 */
function parseCellContent(cellEl) {
  const runs = [];
  const links = [];

  function walk(node, styles) {
    if (node.nodeType === Node.TEXT_NODE) {
      const text = node.textContent;
      if (text) runs.push({ text, ...styles });
      return;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return;

    const tag = node.tagName.toLowerCase();
    const newStyles = { ...styles };

    if (tag === 'strong' || tag === 'b') newStyles.bold = true;
    if (tag === 'em' || tag === 'i') newStyles.italic = true;
    if (tag === 'code') newStyles.code = true;
    if (tag === 'a') {
      const href = node.getAttribute('href');
      if (href) links.push({ text: node.textContent, href });
    }

    for (const child of node.childNodes) {
      walk(child, newStyles);
    }
  }

  walk(cellEl, { bold: false, italic: false, code: false });
  return { runs, links };
}

/**
 * Measure the width of styled text runs on a canvas context.
 */
function measureRuns(ctx, runs, fontSize, fontFamily, codeFontFamily) {
  let width = 0;
  for (const run of runs) {
    const family = run.code ? codeFontFamily : fontFamily;
    const weight = run.bold ? '600' : '400';
    const style = run.italic ? 'italic' : 'normal';
    ctx.font = `${style} ${weight} ${fontSize}px ${family}`;
    width += ctx.measureText(run.text).width;
    if (run.code) width += 8;
  }
  return width;
}

/**
 * Draw styled text runs onto a canvas context.
 */
function drawRuns(ctx, runs, x, y, fontSize, fontFamily, codeFontFamily, textColor, codeColor, codeBg) {
  for (const run of runs) {
    const family = run.code ? codeFontFamily : fontFamily;
    const weight = run.bold ? '600' : '400';
    const style = run.italic ? 'italic' : 'normal';
    ctx.font = `${style} ${weight} ${fontSize}px ${family}`;

    if (run.code) {
      const w = ctx.measureText(run.text).width;
      ctx.fillStyle = codeBg;
      ctx.fillRect(x - 1, y - fontSize * 0.45, w + 6, fontSize * 1.1);
      ctx.fillStyle = codeColor;
      ctx.fillText(run.text, x + 2, y);
      x += w + 8;
    } else {
      ctx.fillStyle = textColor;
      ctx.fillText(run.text, x, y);
      x += ctx.measureText(run.text).width;
    }
  }
}

function renderTableToImage(tableEl) {
  const headerCells = [];
  const bodyCells = [];
  const allLinks = [];
  let linkCounter = 0;

  const thead = tableEl.querySelector('thead');


  if (thead) {
    thead.querySelectorAll('th').forEach((th) => {
      const parsed = parseCellContent(th);
      headerCells.push(parsed);
    });
  }


  const bodyContainer = thead ? (tableEl.querySelector('tbody') || tableEl) : tableEl;
  const bodyRows = bodyContainer.querySelectorAll('tr');
  let startRow = 0;

  if (headerCells.length === 0 && bodyRows.length > 0) {
    if (bodyRows[0].querySelector('th') !== null) {
      bodyRows[0].querySelectorAll('th, td').forEach((c) => {
        headerCells.push(parseCellContent(c));
      });
      startRow = 1;
    }
  }

  for (let i = startRow; i < bodyRows.length; i++) {
    const row = [];
    bodyRows[i].querySelectorAll('td, th').forEach((c) => {
      row.push(parseCellContent(c));
    });
    if (row.length > 0) bodyCells.push(row);
  }

  const cols = Math.max(headerCells.length, ...bodyCells.map((r) => r.length), 0);
  if (cols === 0) return null;

  const superscripts = ['¹','²','³','⁴','⁵','⁶','⁷','⁸','⁹'];
  function toSuperscript(n) {
    return n <= 9 ? superscripts[n - 1] : `^${n}`;
  }

  // Replace link text in cells with superscript markers
  function processLinksInCell(cell) {
    if (cell.links.length === 0) return;

    for (const link of cell.links) {
      linkCounter++;
      allLinks.push({ index: linkCounter, href: link.href });


      for (const run of cell.runs) {
        if (run.text.includes(link.text)) {
          run.text = run.text.replace(link.text, `${link.text}${toSuperscript(linkCounter)}`);
          break;
        }
      }
    }
  }

  headerCells.forEach(processLinksInCell);
  bodyCells.forEach((row) => row.forEach(processLinksInCell));

  // Column alignment
  const alignments = [];
  const alignSourceRow = thead ? thead.querySelectorAll('th') : (bodyRows[0]?.querySelectorAll('th, td') || []);
  alignSourceRow.forEach((c) => {
    const align = c.style?.textAlign || 'left';
    alignments.push(align);
  });


  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  const dpr = 2;

  const cellPadX = 16;
  const cellPadY = 10;
  const fontSize = 14;
  const fontFamily = '"Inter", "Segoe UI", Arial, sans-serif';
  const codeFontFamily = '"JetBrains Mono", "Consolas", monospace';
  const borderColor = '#d0d5dd';
  const headerBg = '#f2f4f7';
  const headerColor = '#344054';
  const cellColor = '#475467';
  const codeColor = '#b54e32';
  const codeBg = '#f0f0f5';
  const rowAltBg = '#f9fafb';
  const rowBg = '#ffffff';

  ctx.font = `${fontSize}px ${fontFamily}`;

  // Column widths
  const colWidths = new Array(cols).fill(0);

  headerCells.forEach((cell, i) => {
    const w = measureRuns(ctx, cell.runs, fontSize, fontFamily, codeFontFamily);
    colWidths[i] = Math.max(colWidths[i], w + cellPadX * 2);
  });
  bodyCells.forEach((row) => {
    row.forEach((cell, i) => {
      const w = measureRuns(ctx, cell.runs, fontSize, fontFamily, codeFontFamily);
      colWidths[i] = Math.max(colWidths[i] || 0, w + cellPadX * 2);
    });
  });

  for (let i = 0; i < cols; i++) {
    colWidths[i] = Math.max(colWidths[i] || 80, 60);
  }

  const totalWidth = colWidths.reduce((a, b) => a + b, 0);
  const rowHeight = fontSize + cellPadY * 2;
  const headerHeight = fontSize + cellPadY * 2;
  const totalHeight = (headerCells.length > 0 ? headerHeight : 0) + bodyCells.length * rowHeight;

  canvas.width = (totalWidth + 2) * dpr;
  canvas.height = (totalHeight + 2) * dpr;
  canvas.style.width = `${totalWidth + 2}px`;
  canvas.style.height = `${totalHeight + 2}px`;
  ctx.scale(dpr, dpr);

  // Background
  ctx.fillStyle = rowBg;
  ctx.fillRect(0, 0, totalWidth + 2, totalHeight + 2);

  let y = 1;

  // Header
  if (headerCells.length > 0) {
    ctx.fillStyle = headerBg;
    ctx.fillRect(1, y, totalWidth, headerHeight);

    let x = 1;
    for (let i = 0; i < cols; i++) {
      ctx.strokeStyle = borderColor;
      ctx.lineWidth = 1;
      ctx.strokeRect(x, y, colWidths[i], headerHeight);

      const cell = headerCells[i] || { runs: [] };
      const boldRuns = cell.runs.map((r) => ({ ...r, bold: true }));

      const align = alignments[i] || 'left';
      const textW = measureRuns(ctx, boldRuns, fontSize, fontFamily, codeFontFamily);
      let textX = x + cellPadX;
      if (align === 'center') textX = x + (colWidths[i] - textW) / 2;
      else if (align === 'right') textX = x + colWidths[i] - cellPadX - textW;

      ctx.textBaseline = 'middle';
      drawRuns(ctx, boldRuns, textX, y + headerHeight / 2, fontSize, fontFamily, codeFontFamily, headerColor, codeColor, codeBg);
      x += colWidths[i];
    }
    y += headerHeight;
  }

  // Body rows
  bodyCells.forEach((row, rowIdx) => {
    const bg = rowIdx % 2 === 0 ? rowBg : rowAltBg;
    ctx.fillStyle = bg;
    ctx.fillRect(1, y, totalWidth, rowHeight);

    let x = 1;
    for (let i = 0; i < cols; i++) {
      ctx.strokeStyle = borderColor;
      ctx.lineWidth = 1;
      ctx.strokeRect(x, y, colWidths[i], rowHeight);

      const cell = row[i] || { runs: [] };
      const align = alignments[i] || 'left';
      const textW = measureRuns(ctx, cell.runs, fontSize, fontFamily, codeFontFamily);
      let textX = x + cellPadX;
      if (align === 'center') textX = x + (colWidths[i] - textW) / 2;
      else if (align === 'right') textX = x + colWidths[i] - cellPadX - textW;

      ctx.textBaseline = 'middle';
      drawRuns(ctx, cell.runs, textX, y + rowHeight / 2, fontSize, fontFamily, codeFontFamily, cellColor, codeColor, codeBg);
      x += colWidths[i];
    }
    y += rowHeight;
  });

  return { dataUrl: canvas.toDataURL('image/png'), links: allLinks };
}

/** Convert all tables in the preview to images (also stores them for clipboard copy). */
let tableImages = [];

function convertTablesToImages(container) {
  tableImages = [];
  const tables = container.querySelectorAll('table');

  tables.forEach((table, idx) => {
    const result = renderTableToImage(table);
    if (!result) return;

    const alt = `Table ${idx + 1}`;
    tableImages.push({ dataUrl: result.dataUrl, alt, links: result.links });

    // Wrapper with badge + copy button
    const wrapper = document.createElement('div');
    wrapper.className = 'table-image-wrapper';

    const img = document.createElement('img');
    img.src = result.dataUrl;
    img.alt = alt;

    const badge = document.createElement('span');
    badge.className = 'table-image-badge';
    badge.textContent = 'Table → Image';

    const copyImgBtn = document.createElement('button');
    copyImgBtn.className = 'table-image-copy';
    copyImgBtn.type = 'button';
    copyImgBtn.title = 'Copy table image to clipboard (then paste into Medium)';
    copyImgBtn.textContent = 'Copy Image';

    copyImgBtn.addEventListener('click', async () => {
      try {
        const resp = await fetch(result.dataUrl);
        const blob = await resp.blob();
        await navigator.clipboard.write([
          new ClipboardItem({ 'image/png': blob }),
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

    wrapper.appendChild(img);
    wrapper.appendChild(badge);
    wrapper.appendChild(copyImgBtn);

    // Link references below the image
    if (result.links.length > 0) {
      const refDiv = document.createElement('p');
      refDiv.className = 'table-link-refs';
      const refItems = result.links.map(
        (link) => `<a href="${link.href}" target="_blank" rel="noopener" class="ref-link">[${link.index}]</a>`
      );
      refDiv.innerHTML = `<strong><em>Reference:</em></strong> <em>${refItems.join(', ')}</em>`;
      wrapper.appendChild(refDiv);
    }

    table.replaceWith(wrapper);
  });
}

// ───────────────────────────────────────
// Live Markdown Preview
// ───────────────────────────────────────

function updateWordCharStats(text, elementId) {
  const el = document.getElementById(elementId);
  if (!el) return;
  const safeText = text || '';
  const chars = safeText.length;
  const words = safeText.trim() ? safeText.trim().split(/\s+/).length : 0;
  el.textContent = `${words.toLocaleString()} words • ${chars.toLocaleString()} chars`;
}

function renderPreview() {
  const md = markdownInput.value.trim();

  if (!md) {
    previewContent.innerHTML = `<div class="preview-placeholder"><p>Your preview will appear here</p></div>`;
    updateWordCharStats('', 'md-preview-stats');
    return;
  }

  previewContent.innerHTML = `<div class="medium-preview">${marked.parse(preprocessForMedium(md))}</div>`;

  convertTablesToImages(previewContent);
  updateWordCharStats(previewContent.innerText || '', 'md-preview-stats');
}

// Debounced preview
let debounceTimer;
markdownInput.addEventListener('input', () => {
  clearTimeout(debounceTimer);
  debounceTimer = setTimeout(renderPreview, 150);
});

// ───────────────────────────────────────
// Synchronized Scrolling (MD → Medium)
// ───────────────────────────────────────

let isSyncingScroll = false;

markdownInput.addEventListener('scroll', () => {
  if (isSyncingScroll) return;
  isSyncingScroll = true;
  const editorScrollable = markdownInput.scrollHeight - markdownInput.clientHeight;
  if (editorScrollable > 0) {
    const ratio = markdownInput.scrollTop / editorScrollable;
    const previewScrollable = previewContent.scrollHeight - previewContent.clientHeight;
    previewContent.scrollTop = ratio * previewScrollable;
  }
  requestAnimationFrame(() => { isSyncingScroll = false; });
});

previewContent.addEventListener('scroll', () => {
  if (isSyncingScroll) return;
  isSyncingScroll = true;
  const previewScrollable = previewContent.scrollHeight - previewContent.clientHeight;
  if (previewScrollable > 0) {
    const ratio = previewContent.scrollTop / previewScrollable;
    const editorScrollable = markdownInput.scrollHeight - markdownInput.clientHeight;
    markdownInput.scrollTop = ratio * editorScrollable;
  }
  requestAnimationFrame(() => { isSyncingScroll = false; });
});

// ───────────────────────────────────────
// File Upload
// ───────────────────────────────────────

const uploadBtn = document.getElementById('upload-btn');
const uploadModal = document.getElementById('upload-modal');
const closeUploadModal = document.getElementById('close-upload-modal');
const folderInput = document.getElementById('folder-input');

uploadBtn.addEventListener('click', () => {
  uploadModal.hidden = false;
  const uploadModalDefault = document.getElementById('upload-modal-default');
  const uploadModalSelection = document.getElementById('upload-modal-selection');
  if (uploadModalDefault) uploadModalDefault.hidden = false;
  if (uploadModalSelection) uploadModalSelection.hidden = true;
});
closeUploadModal.addEventListener('click', () => {
  uploadModal.hidden = true;
});
uploadModal.addEventListener('click', (e) => {
  if (e.target === uploadModal) uploadModal.hidden = true;
});

const uploadModalDefault = document.getElementById('upload-modal-default');
const uploadModalSelection = document.getElementById('upload-modal-selection');
const uploadModalFileList = document.getElementById('upload-modal-file-list');
const uploadModalCancel = document.getElementById('upload-modal-cancel');

if (uploadModalCancel) {
  uploadModalCancel.addEventListener('click', () => {
    if (uploadModalSelection) uploadModalSelection.hidden = true;
    if (uploadModalDefault) uploadModalDefault.hidden = false;
  });
}

function handleMarkdownUpload(filesList) {
  const files = Array.from(filesList);
  if (!files.length) return;

  if (fileInput) fileInput.value = '';
  if (folderInput) folderInput.value = '';

  const mdFiles = files.filter(f => f.name.match(/\.(md|markdown|txt)$/i));

  if (mdFiles.length === 0) {
    alert("No Markdown (.md, .markdown, .txt) files were found in the selected folder.");
    return;
  }

  const otherFiles = files.filter(f => f.type.startsWith('image/'));
  const fileMap = {};
  otherFiles.forEach(f => {
    if (f.webkitRelativePath) fileMap[f.webkitRelativePath] = f;
    fileMap[f.name] = f;
  });

  if (mdFiles.length > 1 && uploadModalDefault && uploadModalSelection && uploadModalFileList) {
    uploadModalDefault.hidden = true;
    uploadModalSelection.hidden = false;
    uploadModalFileList.innerHTML = '';
    
    mdFiles.forEach((mdFile) => {
      const btn = document.createElement('button');
      btn.className = 'btn btn-secondary';
      btn.style.display = 'block';
      btn.style.width = '100%';
      btn.style.textAlign = 'left';
      btn.style.fontWeight = '500';
      btn.style.overflow = 'hidden';
      btn.style.textOverflow = 'ellipsis';
      btn.style.whiteSpace = 'nowrap';
      
      const displayName = mdFile.name;
      btn.textContent = displayName;
      
      btn.onclick = () => {
        uploadModalSelection.hidden = true;
        uploadModalDefault.hidden = false;
        processMarkdownFile(mdFile, fileMap);
      };
      
      uploadModalFileList.appendChild(btn);
    });
    return;
  }

  processMarkdownFile(mdFiles[0], fileMap);
}

function processMarkdownFile(mdFile, fileMap) {
  const reader = new FileReader();
  reader.onload = (ev) => {
    let content = ev.target.result;
    
    content = content.replace(/!\[([^\]]*)\]\(([^\)]+)\)/g, (match, alt, src) => {
      if (/^(https?:|data:)/.test(src)) return match;
      
      let matchedFile = null;
      const cleanSrc = src.replace(/^\.\//, '');
      const possiblePathMatches = Object.keys(fileMap).filter(path => path.endsWith(cleanSrc));
      
      if (possiblePathMatches.length > 0) {
        matchedFile = fileMap[possiblePathMatches[0]];
      } else {
        const filename = src.split('/').pop();
        if (fileMap[filename]) matchedFile = fileMap[filename];
      }

      if (matchedFile) {
        const blobUrl = URL.createObjectURL(matchedFile);
        previewBlobUrls.push(blobUrl);
        return `![${alt}](${blobUrl})`;
      }
      return match;
    });

    markdownInput.value = content;
    renderPreview();
    uploadModal.hidden = true;
  };
  reader.readAsText(mdFile);
}

fileInput.addEventListener('change', (e) => handleMarkdownUpload(e.target.files));
if (folderInput) folderInput.addEventListener('change', (e) => handleMarkdownUpload(e.target.files));

// ───────────────────────────────────────
// Reformat Markdown
// ───────────────────────────────────────

/**
 * Align GFM table columns: pad every cell so columns have equal width.
 * Separator rows keep their alignment markers (`:---`, `---:`, `:---:`).
 */
function alignMarkdownTables(text) {
  // Match one or more consecutive lines that start with |
  return text.replace(/((?:^\|[^\n]+\n)+)/gm, (block) => {
    const rawLines = block.split('\n').filter((l) => l.trim().startsWith('|'));
    if (rawLines.length < 2) return block;

    const parseCells = (line) =>
      line.replace(/^\s*\||\|\s*$/g, '').split('|').map((c) => c.trim());

    const rows = rawLines.map(parseCells);

    // Second row must be a separator (cells contain only `-`, `:`)
    const isSepRow = (row) => row.length > 0 && row.every((c) => /^:?-+:?$/.test(c));
    if (!isSepRow(rows[1])) return block;

    const colCount = Math.max(...rows.map((r) => r.length));

    // Maximum content width per column
    const widths = Array.from({ length: colCount }, (_, col) =>
      Math.max(3, ...rows.map((r) => (r[col] ?? '').length))
    );

    const rebuilt = rows.map((row, ri) => {
      const isSep = ri === 1;
      const cells = Array.from({ length: colCount }, (_, col) => {
        const cell = row[col] ?? '';
        const w = widths[col];
        if (isSep) {
          const lc = cell.startsWith(':');
          const rc = cell.endsWith(':');
          const dashes = Math.max(1, w - (lc ? 1 : 0) - (rc ? 1 : 0));
          return (lc ? ':' : '') + '-'.repeat(dashes) + (rc ? ':' : '');
        }
        return cell.padEnd(w);
      });
      return '| ' + cells.join(' | ') + ' |';
    });

    return rebuilt.join('\n') + '\n';
  });
}

function reformatMarkdown(md) {
  let lines = md.split('\n');

  // 1. Normalize line endings and trim trailing whitespace
  lines = lines.map((line) => line.trimEnd());

  // 2. Ensure blank line before headings
  const result = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const isHeading = /^#{1,6}\s/.test(line);

    if (isHeading && i > 0 && result.length > 0 && result[result.length - 1].trim() !== '') {
      result.push('');
    }

    result.push(line);

    // Ensure blank line after headings
    if (isHeading && i < lines.length - 1 && lines[i + 1].trim() !== '') {
      result.push('');
    }
  }

  let text = result.join('\n');

  // 3. Collapse 3+ blank lines into 2
  text = text.replace(/\n{4,}/g, '\n\n\n');

  // 4. Normalize list markers: replace * and + with -
  text = text.replace(/^(\s*)[*+]\s/gm, '$1- ');

  // 5. Ensure consistent indentation for nested lists (2 spaces)
  text = text.replace(/^\t/gm, '  ');

  // 6. Ensure space after # in headings
  text = text.replace(/^(#{1,6})([^\s#])/gm, '$1 $2');

  // 7. Remove trailing whitespace on non-table lines
  text = text.replace(/^(?!\|).*$/gm, (line) => line.trimEnd());

  // 8. Align table columns
  text = alignMarkdownTables(text);

  // 9. Ensure file ends with single newline
  text = text.trimEnd() + '\n';

  return text;
}

reformatBtn.addEventListener('click', () => {
  const md = markdownInput.value;
  if (!md.trim()) return;

  markdownInput.value = reformatMarkdown(md);
  renderPreview();
});

clearBtn.addEventListener('click', () => {
  if (!markdownInput.value.trim()) return;
  markdownInput.value = '';
  renderPreview();
  markdownInput.focus();
});

// ───────────────────────────────────────
// Fetch Markdown from URL
// ───────────────────────────────────────

mdUrlInput.addEventListener('input', () => {
  if (!mdUrlInput.value.trim()) {
    clearTimeout(mdUrlSuccessTimer);
    mdUrlErrorBar.hidden = true;
    mdUrlErrorBar.textContent = '';
    mdUrlErrorBar.className = 'md-url-error-bar';
  }
});

mdUrlForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const url = mdUrlInput.value.trim();
  if (!url) return;

  // Loading state
  mdUrlFetchBtn.disabled = true;
  mdUrlFetchBtn.querySelector('.md-url-fetch-text').hidden = true;
  mdUrlFetchBtn.querySelector('.md-url-fetch-loader').hidden = false;
  clearTimeout(mdUrlSuccessTimer);
  mdUrlErrorBar.hidden = true;
  mdUrlErrorBar.textContent = '';
  mdUrlErrorBar.className = 'md-url-error-bar';

  try {
    const response = await fetch('/api/fetch-md', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url }),
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || 'Failed to fetch');
    }

    markdownInput.value = data.content;
    renderPreview();

    mdUrlErrorBar.textContent = '✓ Loaded successfully';
    mdUrlErrorBar.className = 'md-url-error-bar success';
    mdUrlErrorBar.hidden = false;
    mdUrlSuccessTimer = setTimeout(() => {
      mdUrlErrorBar.hidden = true;
      mdUrlErrorBar.textContent = '';
      mdUrlErrorBar.className = 'md-url-error-bar';
    }, 3000);
  } catch (err) {
    mdUrlErrorBar.className = 'md-url-error-bar';
    mdUrlErrorBar.textContent = err.message;
    mdUrlErrorBar.hidden = false;
  } finally {
    mdUrlFetchBtn.disabled = false;
    mdUrlFetchBtn.querySelector('.md-url-fetch-text').hidden = false;
    mdUrlFetchBtn.querySelector('.md-url-fetch-loader').hidden = true;
  }
});

// ───────────────────────────────────────
// Copy to Clipboard (with table images)
// ───────────────────────────────────────

const ADMONITION_TYPE_MAP = {
  NOTE: 'Note',
  IMPORTANT: 'Important',
  WARNING: 'Warning',
  CAUTION: 'Caution',
  TIP: 'Tip',
};

/**
 * Convert GitHub-style admonitions to Medium italic+bold callouts.
 */
function convertAdmonitionsForMedium(markdown) {
  return markdown.replace(
    /^> \[!(NOTE|IMPORTANT|WARNING|CAUTION|TIP)\]\n((?:> [^\n]*\n?)+)/gm,
    (match, type, contentBlock) => {
      const label = ADMONITION_TYPE_MAP[type];
      const content = contentBlock
        .split('\n')
        .filter((l) => l.trim())
        .map((l) => l.replace(/^> ?/, ''))
        .join(' ');
      return `> _**${label}:** ${content}_\n`;
    }
  );
}

/**
 * Transform list hierarchy in HTML for Medium copy-paste.
 * Case 1: Flat bullets only → keep as-is.
 * Case 2: 2 levels → top-level = <ol>, sub-items = <ul>.
 * Case 3: 3 levels → top-level = <ol>, sub = <ul>, sub-sub items get a) b) c) prefixes.
 */
function transformListsForMedium(html) {
  const tempDiv = document.createElement('div');
  tempDiv.innerHTML = html;

  // Find all top-level lists (not nested inside another list)
  const allLists = tempDiv.querySelectorAll('ul, ol');
  const topLists = Array.from(allLists).filter(list => list.parentElement.closest('ul, ol') === null);

  topLists.forEach((list) => {
    // Determine maximum nesting depth
    const maxDepth = getMaxDepth(list, 1);

    if (maxDepth === 1) {
      // Case 1: flat bullets — keep original format, no transformation
      return;
    }

    // Convert nested <ol> to <ul> at depth 2
    const depth2Lists = list.querySelectorAll(':scope > li > ul, :scope > li > ol');
    depth2Lists.forEach((nested) => {
      // Force depth 2 to be UL
      if (nested.tagName === 'OL') {
        const ul = document.createElement('ul');
        while (nested.firstChild) ul.appendChild(nested.firstChild);
        Array.from(nested.attributes).forEach(a => ul.setAttribute(a.name, a.value));
        nested.replaceWith(ul);
        nested = ul;
      }
      
      // Flatten depth 3+ continuously into depth 2
      let deepList;
      while ((deepList = nested.querySelector('ul, ol')) !== null) {
         const parentLi = deepList.closest('li');
         const items = Array.from(deepList.children).filter(c => c.tagName === 'LI');
         
         let currentLi = parentLi;
         items.forEach((li, idx) => {
             const letter = String.fromCharCode(97 + (idx % 26));
             const firstEl = li.firstElementChild;
             if (firstEl && (firstEl.tagName === 'P' || firstEl.tagName === 'DIV' || firstEl.tagName === 'SPAN')) {
                 firstEl.insertAdjacentHTML('afterbegin', `<strong>${letter})</strong> `);
             } else {
                 li.insertAdjacentHTML('afterbegin', `<strong>${letter})</strong> `);
             }
             
             // Move to depth 2 as sibling of parentLi to flatten nesting
             currentLi.insertAdjacentElement('afterend', li);
             currentLi = li;
         });
         deepList.remove();
      }
    });

    // Map top-level list arrays into explicit physical DOM paragraph nodes for strict persistent formatting
    const items = Array.from(list.children).filter(c => c.tagName === 'LI');
    items.forEach((li, idx) => {
        const nestedList = li.querySelector(':scope > ul, :scope > ol');
        
        const hasBlock = Array.from(li.children).some(c => c.tagName === 'P' || c.tagName === 'DIV' || c.tagName === 'BLOCKQUOTE');
        const wrapper = document.createElement(hasBlock ? 'div' : 'p');
        
        Array.from(li.childNodes).forEach(child => {
            if (child !== nestedList) {
                wrapper.appendChild(child);
            }
        });

        const firstEl = wrapper.firstElementChild;
        if (firstEl && (firstEl.tagName === 'P' || firstEl.tagName === 'DIV' || firstEl.tagName === 'SPAN')) {
            firstEl.insertAdjacentHTML('afterbegin', `<strong>${idx + 1}.</strong> `);
        } else {
            wrapper.insertAdjacentHTML('afterbegin', `<strong>${idx + 1}.</strong> `);
        }

        list.parentNode.insertBefore(wrapper, list);
        if (nestedList) {
            list.parentNode.insertBefore(nestedList, list);
        }
    });
    list.remove();
  });

  return tempDiv.innerHTML;
}

function getMaxDepth(listEl, currentDepth) {
  let max = currentDepth;
  listEl.querySelectorAll(':scope > li').forEach((li) => {
    li.querySelectorAll(':scope > ul, :scope > ol').forEach((nested) => {
      const d = getMaxDepth(nested, currentDepth + 1);
      if (d > max) max = d;
    });
  });
  return max;
}

/** Build Medium-compatible HTML, replacing tables with base64 image tags. */
function buildMediumHtml(markdown) {
  let html = marked.parse(preprocessForMedium(markdown));

  // Replace tables with images + link references
  if (tableImages.length > 0) {
    const tempDiv = document.createElement('div');
    tempDiv.innerHTML = html;
    const tables = tempDiv.querySelectorAll('table');

    tables.forEach((table, idx) => {
      if (idx < tableImages.length) {
        const container = document.createElement('div');

        const img = document.createElement('img');
        img.src = tableImages[idx].dataUrl;
        img.alt = tableImages[idx].alt;
        img.style.maxWidth = '100%';
        container.appendChild(img);


        if (tableImages[idx].links && tableImages[idx].links.length > 0) {
          const refDiv = document.createElement('p');
          const refItems = tableImages[idx].links.map(
            (link) => `<a href="${link.href}">[${link.index}]</a>`
          );
          refDiv.innerHTML = `<strong><em>Reference:</em></strong> <em>${refItems.join(', ')}</em>`;
          refDiv.style.fontSize = '13px';
          refDiv.style.color = '#666';
          container.appendChild(refDiv);
        }

        table.replaceWith(container);
      }
    });

    html = tempDiv.innerHTML;
  }

  // Transform list hierarchy for Medium paste
  html = transformListsForMedium(html);

  return html;
}

copyBtn.addEventListener('click', async () => {
  const md = markdownInput.value.trim();
  if (!md) return;

  const html = buildMediumHtml(md);
  let success = false;

  // Attempt 1: Clipboard API (HTTPS / localhost)
  try {
    await navigator.clipboard.write([
      new ClipboardItem({
        'text/html': new Blob([html], { type: 'text/html' }),
        'text/plain': new Blob([md], { type: 'text/plain' }),
      }),
    ]);
    success = true;
  } catch (_) {
    // Attempt 2: clone post-processed HTML into DOM and execCommand('copy')
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
    } catch (_) { /* nothing more to try */ }
  }

  copyBtn.textContent = success ? 'Copied!' : 'Failed!';
  copyBtn.style.pointerEvents = 'none';

  setTimeout(() => {
    copyBtn.textContent = 'Copy';
    copyBtn.style.pointerEvents = '';
  }, 2000);
});

// ───────────────────────────────────────
// Copy Markdown (Medium → MD panel)
// ───────────────────────────────────────

m2mdCopyBtn.addEventListener('click', async () => {
  if (!currentMarkdownContent) return;

  let success = false;

  try {
    await navigator.clipboard.writeText(currentMarkdownContent);
    success = true;
  } catch (_) {
    try {
      const ta = document.createElement('textarea');
      ta.value = currentMarkdownContent;
      ta.style.cssText = 'position:fixed;opacity:0;pointer-events:none';
      document.body.appendChild(ta);
      ta.select();
      success = document.execCommand('copy');
      document.body.removeChild(ta);
    } catch (_) { /* nothing more to try */ }
  }

  m2mdCopyBtn.textContent = success ? 'Copied!' : 'Failed!';
  m2mdCopyBtn.style.pointerEvents = 'none';

  setTimeout(() => {
    m2mdCopyBtn.textContent = 'Copy';
    m2mdCopyBtn.style.pointerEvents = '';
  }, 2000);
});

// ───────────────────────────────────────
// Export — HTML & PDF
// ───────────────────────────────────────

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
    pdf.save(filename); // Try final browser save if network fails
  }
}

async function exportToPdf(paneEl, filename, btnEl) {
  const inner = paneEl.querySelector('.medium-preview');
  if (!inner) return;

  const originalText = btnEl.textContent;
  btnEl.textContent = '...';
  btnEl.disabled = true;

  // A4 dimensions (96 dpi → px, mm)
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

  // Resolve CSS custom properties for the offscreen clone
  const cs = getComputedStyle(document.documentElement);
  const resolve = (v) => cs.getPropertyValue(v).trim();

  // ── Offscreen container (scoped to prevent style leak) ─────────────────
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

  // Scoped styles — prefixed with .pdf-export-offscreen to avoid leaking
  const S = `.${SCOPE}`;
  const styleEl = document.createElement('style');
  styleEl.textContent = `
    /* ── Typography ──────────────────────── */
    ${S} h1 {
      font-family: "ABeeZee", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      font-size: 2rem;
      font-weight: 700;
      letter-spacing: -0.02em;
      line-height: 1.2;
      margin: 0 0 ${resolve('--s6') || '24px'} 0;
      color: ${resolve('--text-primary') || textColor};
    }
    ${S} h2 {
      font-family: "ABeeZee", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      font-size: 1.4375rem;
      font-weight: 700;
      letter-spacing: -0.01em;
      line-height: 1.3;
      margin: ${resolve('--s8') || '48px'} 0 ${resolve('--s4') || '16px'} 0;
      color: ${resolve('--text-primary') || textColor};
    }
    ${S} h3 {
      font-family: "ABeeZee", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      font-size: 1.125rem;
      font-weight: 700;
      line-height: 1.4;
      margin: ${resolve('--s6') || '24px'} 0 ${resolve('--s3') || '12px'} 0;
      color: ${resolve('--text-primary') || textColor};
    }
    ${S} h4, ${S} h5, ${S} h6 {
      font-family: "ABeeZee", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      font-weight: 700;
      line-height: 1.4;
      margin: ${resolve('--s5') || '20px'} 0 ${resolve('--s2') || '8px'} 0;
      color: ${resolve('--text-primary') || textColor};
    }
    ${S} p {
      font-family: "ABeeZee", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      font-size: 1rem;
      line-height: 1.85;
      margin: 0 0 ${resolve('--s5') || '20px'} 0;
      color: ${resolve('--text-secondary') || textColor};
    }
    ${S} a {
      color: ${resolve('--accent') || '#2563EB'};
      text-decoration: underline;
    }
    ${S} strong {
      font-weight: 700;
      color: ${resolve('--text-primary') || textColor};
    }
    ${S} em {
      font-style: italic;
      color: ${resolve('--text-secondary') || textColor};
    }

    /* ── Blockquotes ─────────────────────── */
    ${S} blockquote {
      border-left: 2px solid ${resolve('--accent') || '#2563EB'};
      padding: ${resolve('--s3') || '12px'} ${resolve('--s6') || '24px'};
      margin: ${resolve('--s6') || '24px'} 0;
      color: ${resolve('--text-muted') || '#6e6e6e'};
      font-style: italic;
      background: ${isDark ? 'rgba(59,130,246,0.07)' : 'rgba(37,99,235,0.04)'};
      border-radius: 0 ${resolve('--r-sm') || '3px'} ${resolve('--r-sm') || '3px'} 0;
    }

    /* ── Code ────────────────────────────── */
    ${S} code {
      font-family: "JetBrains Mono", "Fira Code", monospace;
      font-size: 0.82em;
      padding: 2px 6px;
      background: ${isDark ? '#1e3a5f' : '#eff6ff'};
      color: ${isDark ? '#93c5fd' : '#1e40af'};
      border: 1px solid ${isDark ? '#2d5a8e' : '#bfdbfe'};
      border-radius: ${resolve('--r-sm') || '3px'};
      display: inline-block;
      max-width: 100%;
      word-break: break-word;
      white-space: pre-wrap;
    }
    ${S} pre {
      background: ${isDark ? '#0a0a0a' : '#171717'} !important;
      color: #e0e0e0 !important;
      border: 1px solid ${isDark ? '#1e1e1e' : '#2c2c2c'};
      border-radius: ${resolve('--r-md') || '5px'} !important;
      margin: ${resolve('--s6') || '24px'} 0 !important;
      overflow: hidden !important;
      white-space: pre-wrap !important;
      word-break: break-all !important;
    }
    ${S} pre code {
      display: block;
      padding: ${resolve('--s5') || '20px'} ${resolve('--s6') || '24px'} !important;
      background: transparent !important;
      color: inherit !important;
      border: none !important;
      border-radius: 0 !important;
      font-size: 0.8125rem !important;
      line-height: 1.7 !important;
    }

    /* ── Lists (DOM markers for html2canvas compatibility) ── */
    ${S} ul, ${S} ol {
      padding-left: 0;
      margin: 0 0 ${resolve('--s5') || '20px'} 0;
      list-style: none;
    }
    ${S} li {
      display: flex;
      align-items: baseline;
      margin-bottom: ${resolve('--s2') || '8px'};
      color: ${resolve('--text-secondary') || textColor};
      font-size: 1rem;
      line-height: 1.8;
      padding-left: 0.4em;
    }
    ${S} .pdf-list-marker {
      flex-shrink: 0;
      width: 1.6em;
      text-align: left;
      user-select: none;
      color: ${resolve('--text-secondary') || textColor};
    }
    ${S} .pdf-list-content {
      flex: 1;
      min-width: 0;
    }

    /* ── Images ──────────────────────────── */
    ${S} img {
      max-width: 100%;
      height: auto;
      border-radius: ${resolve('--r-md') || '5px'};
      margin: ${resolve('--s6') || '24px'} 0;
      border: 1px solid ${resolve('--border') || '#e2e2e2'};
      display: block;
    }

    /* ── Horizontal rule ─────────────────── */
    ${S} hr {
      border: none;
      height: 1px;
      background: ${resolve('--border') || '#e2e2e2'};
      margin: ${resolve('--s8') || '48px'} 0;
    }

    /* ── Tables ──────────────────────────── */
    ${S} table {
      width: 100%;
      border-collapse: collapse;
      margin: ${resolve('--s6') || '24px'} 0;
      font-size: 0.9375rem;
    }
    ${S} th, ${S} td {
      padding: ${resolve('--s2') || '8px'} ${resolve('--s4') || '16px'};
      border: 1px solid ${resolve('--border') || '#e2e2e2'};
      text-align: left;
    }
    ${S} th {
      background: ${resolve('--bg-subtle') || '#efefef'};
      font-weight: 700;
      color: ${resolve('--text-primary') || textColor};
      font-size: 0.75rem;
      text-transform: uppercase;
      letter-spacing: 0.07em;
    }
    ${S} td {
      color: ${resolve('--text-secondary') || textColor};
    }

    /* ── Table images ────────────────────── */
    ${S} .table-image-wrapper { display: block; margin: ${resolve('--s6') || '24px'} 0; max-width: 100%; }
    ${S} .table-image-wrapper img { margin: 0; border-radius: ${resolve('--r-sm') || '3px'}; }
    ${S} .table-image-badge, ${S} .table-image-copy, ${S} .m2md-image-copy { display: none !important; }

    /* ── Highlight.js ────────────────────── */
    ${S} .hljs { background: transparent !important; }
  `;
  wrap.appendChild(styleEl);

  const clone = inner.cloneNode(true);
  clone.style.cssText = 'width:100%;max-width:100%;margin:0;padding:0;';

  // Map native list CSS markers into distinct physical DOM span elements for deterministic canvas rasterization
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
    // ── Page break computation ──────────────────────────────────────────
    const children = Array.from(clone.children);
    const elementBounds = children.map((el) => {
      const top = el.offsetTop;
      const height = el.offsetHeight;
      return { top, bottom: top + height };
    });

    const pageBreaks = [0];
    let pageBottom = CONTENT_H;

    for (const bounds of elementBounds) {
      if (bounds.top >= pageBottom) {
        pageBreaks.push(bounds.top);
        pageBottom = bounds.top + CONTENT_H;
      }
      // Element straddles page boundary — break before it (unless taller than a page)
      if (bounds.bottom > pageBottom && bounds.top < pageBottom) {
        const elHeight = bounds.bottom - bounds.top;
        if (elHeight <= CONTENT_H) {
          pageBreaks.push(bounds.top);
          pageBottom = bounds.top + CONTENT_H;
        } else {
          // Oversized element — let it span multiple pages
          if (bounds.top > pageBreaks[pageBreaks.length - 1]) {
            pageBreaks.push(bounds.top);
          }
          pageBottom = bounds.top + CONTENT_H;

          while (pageBottom < bounds.bottom) {
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

    // Collect link positions before removing offscreen container from DOM
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

    // ── Slice into pages ────────────────────────────────────────────────
    const pdf = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait' });
    const pxToMm = CONTENT_W_MM / CONTENT_W;

    for (let i = 0; i < pageBreaks.length; i++) {
      const sliceTopPx = pageBreaks[i];
      const sliceBottomPx = (i + 1 < pageBreaks.length)
        ? pageBreaks[i + 1]
        : totalH;
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

      // Overlay clickable link annotations for this page
      for (const link of linkAnnotations) {
        const linkTop = link.top;
        const linkBottom = link.top + link.height;
        // Check if this link falls within the current page slice
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

    // Strategy 1: Native File System Access API (Stream routing to physical disk)
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
        if (saveErr.name === 'AbortError') return; // user cancelled
        // Fall back to Strategy 2
        await fallbackPdfDownload(pdf, filename);
      }
    } else {
      // Strategy 2: Server fallback
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

// MD→Medium: export HTML
exportHtmlBtn.addEventListener('click', () => {
  const inner = previewContent.querySelector('.medium-preview');
  if (!inner) return;
  const doc = buildExportDocument(inner.innerHTML, 'Medium Preview');
  downloadHtml(doc, 'medium-preview.html');
});

// MD→Medium: export PDF
exportPdfBtn.addEventListener('click', () => {
  exportToPdf(previewContent, 'medium-preview.pdf', exportPdfBtn);
});

// Medium→MD: export HTML
m2mdExportHtmlBtn.addEventListener('click', () => {
  const inner = m2mdPreviewContent.querySelector('.medium-preview');
  if (!inner) return;
  const clone = inner.cloneNode(true);
  clone.querySelectorAll('.m2md-image-copy').forEach((el) => el.remove());
  const doc = buildExportDocument(clone.innerHTML, currentArticleName || 'article');
  downloadHtml(doc, `${currentArticleName || 'article'}.html`);
});

// Medium→MD: export PDF
m2mdExportPdfBtn.addEventListener('click', () => {
  exportToPdf(m2mdPreviewContent, `${currentArticleName || 'article'}.pdf`, m2mdExportPdfBtn);
});

// ───────────────────────────────────────
// Medium URL → Markdown Conversion
// ───────────────────────────────────────

function setLoading(loading) {
  const btnText = convertBtn.querySelector('.btn-text');
  const btnLoader = convertBtn.querySelector('.btn-loader');

  if (loading) {
    btnText.hidden = true;
    btnLoader.hidden = false;
    convertBtn.disabled = true;
    urlInput.disabled = true;
    if (bypassCacheCheckbox) bypassCacheCheckbox.disabled = true;
  } else {
    btnText.hidden = false;
    btnLoader.hidden = true;
    convertBtn.disabled = false;
    urlInput.disabled = false;
    if (bypassCacheCheckbox) bypassCacheCheckbox.disabled = false;
  }
}

function showProgress(percent, text) {
  progressSection.hidden = false;
  progressFill.style.width = `${percent}%`;
  progressText.textContent = text;
}

function hideProgress() {
  progressSection.hidden = true;
  progressFill.style.width = '0%';
}

function showError(message) {
  errorMessage.hidden = false;
  errorText.textContent = message;
}

function hideError() {
  errorMessage.hidden = true;
}

function showDownload() {
  downloadSection.hidden = false;
}

function hideDownload() {
  downloadSection.hidden = true;
}

urlForm.addEventListener('submit', async (e) => {
  e.preventDefault();

  let url = urlInput.value.trim();
  if (!url) return;

  if (bypassCacheCheckbox && bypassCacheCheckbox.checked) {
    const sep = url.includes('?') ? '&' : '?';
    url += `${sep}refresh=${Date.now()}`;
  }

  hideError();
  hideDownload();
  setLoading(true);
  m2mdExportHtmlBtn.disabled = true;
  m2mdExportPdfBtn.disabled = true;

  showProgress(10, 'Fetching article...');

  const progressInterval = setInterval(() => {
    const current = parseFloat(progressFill.style.width) || 10;
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

        const proxyMirrors = [
          'https://freedium-mirror.cfd',
          'https://freedium.cfd',
        ];

        let clientHtml = null;

        for (const mirror of proxyMirrors) {
          try {
            showProgress(40, `Trying ${mirror.split('//')[1]}...`);
            const proxyResp = await fetch(`${mirror}/${url}`, {
              headers: { Accept: 'text/html' },
            });
            if (proxyResp.ok) {
              clientHtml = await proxyResp.text();
              break;
            }
          } catch (proxyErr) {
            console.log(`Proxy ${mirror} failed:`, proxyErr.message);
          }
        }

        if (!clientHtml) {
          throw new Error(
            'Could not fetch the article. Medium blocked server-side access and proxy mirrors are unreachable. ' +
            'Try opening the article in your browser, selecting all content (Ctrl+A), copying (Ctrl+C), ' +
            'and using the Markdown editor tab to paste and convert manually.'
          );
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

    // Parse response
    const data = await response.json();

    // Render preview
    if (data.markdown) {
      // Revoke previous blob URLs to prevent memory leaks
      for (const blobUrl of previewBlobUrls) URL.revokeObjectURL(blobUrl);
      previewBlobUrls = [];

      currentMarkdownContent = data.markdown;
      m2mdCopyBtn.disabled = false;
      m2mdExportHtmlBtn.disabled = false;
      m2mdExportPdfBtn.disabled = false;
      const renderedHtml = marked.parse(stripFrontMatter(currentMarkdownContent));
      m2mdPreviewContent.innerHTML = `<div class="medium-preview">${renderedHtml}</div>`;
      updateWordCharStats(m2mdPreviewContent.innerText || '', 'm2md-preview-stats');

      // Extract images from ZIP for preview
      if (data.zipBase64) {
        try {
          showProgress(95, 'Unpacking ZIP archive...');
          const zip = await JSZip.loadAsync(data.zipBase64, { base64: true });

          const imgElements = [...m2mdPreviewContent.querySelectorAll('img')].filter((img) => {
            const src = img.getAttribute('src') || '';
            return src.replace(/^\.\//, '').startsWith('images/');
          });

          const total = imgElements.length;

          if (total > 0) {
            showProgress(95, total === 1
              ? 'Loading 1 image...'
              : `Loading ${total} images — this may take a moment for large articles...`
            );
          }

          let loaded = 0;
          for (const img of imgElements) {
            const normalizedSrc = (img.getAttribute('src') || '').replace(/^\.\//, '');
            const escapedSrc = normalizedSrc.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            const files = zip.file(new RegExp(escapedSrc + '$'));
            if (files && files.length > 0) {
              const u8 = await files[0].async('uint8array');

              const ext = normalizedSrc.split('.').pop().toLowerCase();
              const mimeTypes = {
                jpg: 'image/jpeg', jpeg: 'image/jpeg',
                png: 'image/png', gif: 'image/gif',
                svg: 'image/svg+xml', webp: 'image/webp',
              };
              const type = mimeTypes[ext] || 'application/octet-stream';

              const blobUrl = URL.createObjectURL(new Blob([u8], { type }));
              previewBlobUrls.push(blobUrl);
              img.src = blobUrl;
            }

            loaded++;
            if (total > 1) {
              showProgress(95, `Loading images (${loaded} of ${total})...`);
            }
          }
          addM2mdCopyImageButtons(m2mdPreviewContent);
        } catch (zipErr) {
          console.error('Failed to extract images from ZIP for preview:', zipErr);
        }
      }

      // Add copy buttons for images loaded from external URLs (no ZIP)
      if (!data.zipBase64) {
        addM2mdCopyImageButtons(m2mdPreviewContent);
      }
    }

    currentZipToken = data.zipToken || null;
    currentZipBase64 = data.zipBase64 || null;
    currentArticleName = data.slug || 'article';


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

// ───────────────────────────────────────
// Download ZIP
// ───────────────────────────────────────

function flashDownloadSuccess() {
  const originalHTML = downloadBtn.innerHTML;
  downloadBtn.innerHTML = `
    <svg width="13" height="13" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
      <path d="M13.78 4.22a.75.75 0 010 1.06l-7.25 7.25a.75.75 0 01-1.06 0L2.22 9.28a.75.75 0 011.06-1.06L6 10.94l6.72-6.72a.75.75 0 011.06 0z"/>
    </svg>
    Saved!`;
  downloadBtn.disabled = true;
  setTimeout(() => {
    downloadBtn.innerHTML = originalHTML;
    downloadBtn.disabled = false;
  }, 2500);
}

downloadBtn.addEventListener('click', async () => {
  if (!currentZipBase64 && !currentZipToken) return;

  // Strategy 1: Native File System Access API (Stream routing to physical disk)
  if (window.showSaveFilePicker) {
    try {
      const fileHandle = await window.showSaveFilePicker({
        suggestedName: `${currentArticleName}.zip`,
        types: [{ description: 'ZIP Archive', accept: { 'application/zip': ['.zip'] } }],
      });

      if (currentZipBase64) {
        const binary = atob(currentZipBase64);
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

  // Strategy 2: Server download URL (Content-Disposition: attachment)
  if (currentZipToken) {
    const tokenToUse = currentZipToken;
    currentZipToken = null;
    const a = document.createElement('a');
    a.href = `/api/download-zip/${tokenToUse}`;
    a.download = `${currentArticleName}.zip`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    flashDownloadSuccess();
    return;
  }

  // Strategy 3: blob: URL (fallback)
  if (currentZipBase64) {
    const binary = atob(currentZipBase64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    const blob = new Blob([bytes], { type: 'application/zip' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${currentArticleName}.zip`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
    flashDownloadSuccess();
  }
});

// ───────────────────────────────────────
// Copy Image buttons (Medium → MD preview)
// ───────────────────────────────────────

function addM2mdCopyImageButtons(container) {
  const images = container.querySelectorAll('.medium-preview img');
  images.forEach((img) => {
    // Skip if already wrapped
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
        // Convert to PNG if not already
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

// ───────────────────────────────────────
// IDE Editor Hotkeys (VS Code style)
// ───────────────────────────────────────

markdownInput.addEventListener('keydown', (e) => {
  const start = markdownInput.selectionStart;
  const end = markdownInput.selectionEnd;
  const selectedText = markdownInput.value.substring(start, end);
  const isMac = navigator.platform.toUpperCase().indexOf('MAC') >= 0;
  const cmdOrCtrl = isMac ? e.metaKey : e.ctrlKey;

  // Helper to safely manipulate text while strictly preserving native browser Undo (Ctrl+Z) / Redo (Ctrl+Y) stacks
  const insertText = (text, newCursorPos = null, newSelectionEnd = null) => {
    e.preventDefault();
    document.execCommand('insertText', false, text);
    if (newCursorPos !== null) {
      markdownInput.selectionStart = newCursorPos;
      markdownInput.selectionEnd = newSelectionEnd !== null ? newSelectionEnd : newCursorPos;
    }
    renderPreview();
  };

  const getLineIndices = (text, col) => {
    let lineStart = text.lastIndexOf('\n', col - 1) + 1;
    let lineEnd = text.indexOf('\n', col);
    if (lineEnd === -1) lineEnd = text.length;
    return { lineStart, lineEnd };
  };

  // 1. Tab indentation
  if (e.key === 'Tab' && !e.shiftKey && !e.ctrlKey && !e.altKey && !e.metaKey) {
    insertText('  ', start + 2);
    return;
  }

  // 2. Formatting Modifiers & Commenting (Ctrl/Cmd + Key)
  if (cmdOrCtrl && !e.shiftKey && !e.altKey) {
    const key = e.key.toLowerCase();
    
    if (key === 'b') { // Bold
      const isBold = selectedText.startsWith('**') && selectedText.endsWith('**');
      if (isBold) {
        insertText(selectedText.slice(2, -2), start, end - 4);
      } else {
        insertText(`**${selectedText}**`, start + 2, end + 2);
      }
      return;
    }
    
    if (key === 'i') { // Italic
      const isItalic = selectedText.startsWith('*') && selectedText.endsWith('*') && !selectedText.startsWith('**');
      if (isItalic) {
        insertText(selectedText.slice(1, -1), start, end - 2);
      } else {
        insertText(`*${selectedText}*`, start + 1, end + 1);
      }
      return;
    }
    
    if (key === 'k') { // Link
      insertText(`[${selectedText}]()`, start + selectedText.length + 3);
      return;
    }

    if (key === '/') { // HTML Comment toggle
      const { lineStart, lineEnd } = getLineIndices(markdownInput.value, start);
      const activeStart = selectedText ? start : lineStart;
      const activeEnd = selectedText ? end : lineEnd;
      const activeText = markdownInput.value.substring(activeStart, activeEnd);
      
      markdownInput.selectionStart = activeStart;
      markdownInput.selectionEnd = activeEnd;
      
      if (activeText.startsWith('<!--') && activeText.endsWith('-->')) {
        insertText(activeText.slice(4, -3).trim(), activeStart, activeStart + activeText.length - 7);
      } else {
        insertText(`<!-- ${activeText} -->`, activeStart, activeStart + activeText.length + 9);
      }
      return;
    }
  }

  // 3. Move Line Up/Down (Alt + ArrowKey)
  if (e.altKey && !cmdOrCtrl && !e.shiftKey) {
    if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      const { lineStart, lineEnd } = getLineIndices(markdownInput.value, start);
      const isUp = e.key === 'ArrowUp';
      
      if (isUp && lineStart > 0) {
        const prevLineInfo = getLineIndices(markdownInput.value, lineStart - 2);
        const thisLine = markdownInput.value.substring(lineStart, lineEnd);
        const prevLine = markdownInput.value.substring(prevLineInfo.lineStart, prevLineInfo.lineEnd);
        
        markdownInput.selectionStart = prevLineInfo.lineStart;
        markdownInput.selectionEnd = lineEnd;
        insertText(`${thisLine}\n${prevLine}`, prevLineInfo.lineStart + (start - lineStart));
        return;
      }
      
      if (!isUp && lineEnd < markdownInput.value.length) {
        const nextLineInfo = getLineIndices(markdownInput.value, lineEnd + 1);
        const thisLine = markdownInput.value.substring(lineStart, lineEnd);
        const nextLine = markdownInput.value.substring(nextLineInfo.lineStart, nextLineInfo.lineEnd);
        
        markdownInput.selectionStart = lineStart;
        markdownInput.selectionEnd = nextLineInfo.lineEnd;
        insertText(`${nextLine}\n${thisLine}`, lineStart + nextLine.length + 1 + (start - lineStart));
        return;
      }
    }
  }

  // 4. Auto-pairing brackets/quotes & Smart Backspace
  if (!cmdOrCtrl && !e.altKey) {
    const pairs = { '(': ')', '[': ']', '{': '}', '<': '>', '"': '"', "'": "'", '`': '`' };
    const closingPairs = { ')': true, ']': true, '}': true, '>': true, '"': true, "'": true, '`': true };
    const nextChar = markdownInput.value.charAt(start);
    const prevChar = markdownInput.value.charAt(start - 1);

    // Smart backspace: delete empty matched pair "(|)" -> "|"
    if (e.key === 'Backspace' && start === end && pairs[prevChar] && pairs[prevChar] === nextChar) {
      markdownInput.selectionStart = start - 1;
      markdownInput.selectionEnd = start + 1;
      insertText('', start - 1, start - 1);
      return;
    }

    // Wrap highlighted text
    if (selectedText.length > 0 && pairs[e.key]) {
      insertText(`${e.key}${selectedText}${pairs[e.key]}`, start + 1, end + 1);
      return;
    }

    // Inject empty pair "()" when nothing is selected
    if (selectedText.length === 0 && pairs[e.key]) {
      // If pressing a quote ' or " that's already injected next, just step over
      if (e.key === nextChar && closingPairs[e.key]) {
        e.preventDefault();
        markdownInput.selectionStart = markdownInput.selectionEnd = start + 1;
      } else {
        insertText(`${e.key}${pairs[e.key]}`, start + 1, start + 1);
      }
      return;
    }

    // Step over standard closing brackets without duplicating
    if (selectedText.length === 0 && closingPairs[e.key] && nextChar === e.key) {
      e.preventDefault();
      markdownInput.selectionStart = markdownInput.selectionEnd = start + 1;
      return;
    }
  }
});

// ───────────────────────────────────────
// Example Article (initial content)
// ───────────────────────────────────────

const EXAMPLE_ARTICLE = `# my-project

A fast, lightweight CLI tool for scaffolding new projects from reusable templates. Works with any language or framework.

## Features

- Instant project scaffolding from local or remote templates
- Interactive prompts with sensible defaults
- Built-in support for Git initialization
- Fully configurable via a single \`project.config.json\` file
- Zero runtime dependencies after install

## Requirements

- Node.js 18 or higher
- npm 9 or higher
- Git (optional, for automatic repository initialization)

## Installation

Install globally via npm:

\`\`\`bash
npm install -g my-project
\`\`\`

Or use it without installing via npx:

\`\`\`bash
npx my-project create my-app
\`\`\`

## Usage

### Create a new project

\`\`\`bash
my-project create <project-name> [--template <name>]
\`\`\`

**Options**

| Flag | Default | Description |
|------|---------|-------------|
| \`--template\` | \`default\` | Template name or path to use |
| \`--no-git\` | — | Skip Git initialization |
| \`--yes\` | — | Accept all prompts with their default values |

### Example

\`\`\`bash
my-project create my-api --template express-ts
cd my-api
npm install
npm run dev
\`\`\`

## Configuration

Create a \`project.config.json\` at the root of your template to control its behavior:

\`\`\`json
{
  "name": "express-ts",
  "description": "Express API with TypeScript and ESLint",
  "prompts": [
    { "name": "port", "message": "Port number?", "default": "3000" }
  ]
}
\`\`\`

> [!NOTE]
> All prompt values are available as template variables using \`{{variable}}\` syntax inside any file in your template.

> [!WARNING]
> Running \`my-project create\` inside an existing non-empty directory will prompt for confirmation before writing any files.

## Contributing

Contributions are welcome. Please open an issue first to discuss what you would like to change.

1. Fork the repository
2. Create a feature branch: \`git checkout -b feat/your-feature\`
3. Commit your changes: \`git commit -m "feat: add your feature"\`
4. Push to the branch: \`git push origin feat/your-feature\`
5. Open a pull request

## License

MIT © 2025 Your Name
`;

markdownInput.value = EXAMPLE_ARTICLE;
renderPreview();

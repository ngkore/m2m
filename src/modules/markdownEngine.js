import { Marked } from 'marked';
import { markedHighlight } from 'marked-highlight';
import hljs from 'highlight.js';
import 'highlight.js/styles/github-dark.min.css';
import { DOM } from './dom.js';

// ───────────────────────────────────────
// Markdown Parser Setup
// ───────────────────────────────────────

export const marked = new Marked(
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

const ADMONITION_TYPE_MAP = {
  NOTE: 'Note',
  IMPORTANT: 'Important',
  WARNING: 'Warning',
  CAUTION: 'Caution',
  TIP: 'Tip',
};

export function convertAdmonitionsForMedium(markdown) {
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

export function stripFrontMatter(markdown) {
  return markdown.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n*/m, '');
}

export function preprocessForMedium(markdown) {
  let md = stripFrontMatter(markdown);

  md = md.replace(/^(\s*[-*+]\s+)\[[ ]\]/gm, '$1☐');
  md = md.replace(/^(\s*[-*+]\s+)\[[xX]\]/gm, '$1☑');

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

export function renderTableToImage(tableEl) {
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

  ctx.fillStyle = rowBg;
  ctx.fillRect(0, 0, totalWidth + 2, totalHeight + 2);

  let y = 1;

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

export let tableImages = [];

export function convertTablesToImages(container) {
  tableImages = [];
  const tables = container.querySelectorAll('table');

  tables.forEach((table, idx) => {
    const result = renderTableToImage(table);
    if (!result) return;

    const alt = `Table ${idx + 1}`;
    tableImages.push({ dataUrl: result.dataUrl, alt, links: result.links });

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

export function updateWordCharStats(text, elementId) {
  const el = document.getElementById(elementId);
  if (!el) return;
  const safeText = text || '';
  const chars = safeText.length;
  const words = safeText.trim() ? safeText.trim().split(/\s+/).length : 0;
  el.textContent = `${words.toLocaleString()} words • ${chars.toLocaleString()} chars`;
}

export function renderPreview() {
  if (!DOM.markdownInput || !DOM.previewContent) return;
  const md = DOM.markdownInput.value.trim();

  if (!md) {
    DOM.previewContent.innerHTML = `<div class="preview-placeholder"><p>Your preview will appear here</p></div>`;
    updateWordCharStats('', 'md-preview-stats');
    return;
  }

  DOM.previewContent.innerHTML = `<div class="medium-preview">${marked.parse(preprocessForMedium(md))}</div>`;

  convertTablesToImages(DOM.previewContent);
  updateWordCharStats(DOM.previewContent.innerText || '', 'md-preview-stats');
}

export function alignMarkdownTables(text) {
  return text.replace(/((?:^\|[^\n]+\n)+)/gm, (block) => {
    const rawLines = block.split('\n').filter((l) => l.trim().startsWith('|'));
    if (rawLines.length < 2) return block;

    const parseCells = (line) => line.replace(/^\s*\||\|\s*$/g, '').split('|').map((c) => c.trim());
    const rows = rawLines.map(parseCells);

    const isSepRow = (row) => row.length > 0 && row.every((c) => /^:?-+:?$/.test(c));
    if (!isSepRow(rows[1])) return block;

    const colCount = Math.max(...rows.map((r) => r.length));
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

export function reformatMarkdown(md) {
  let lines = md.split('\n');
  lines = lines.map((line) => line.trimEnd());
  const result = [];
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const isHeading = /^#{1,6}\s/.test(line);

    if (isHeading && i > 0 && result.length > 0 && result[result.length - 1].trim() !== '') {
      result.push('');
    }
    result.push(line);
    if (isHeading && i < lines.length - 1 && lines[i + 1].trim() !== '') {
      result.push('');
    }
  }

  let text = result.join('\n');
  text = text.replace(/\n{4,}/g, '\n\n\n');
  text = text.replace(/^(\s*)[*+]\s/gm, '$1- ');
  text = text.replace(/^\t/gm, '  ');
  text = text.replace(/^(#{1,6})([^\s#])/gm, '$1 $2');
  text = text.replace(/^(?!\|).*$/gm, (line) => line.trimEnd());
  text = alignMarkdownTables(text);
  text = text.trimEnd() + '\n';

  return text;
}

export function getMaxDepth(listEl, currentDepth) {
  let max = currentDepth;
  listEl.querySelectorAll(':scope > li').forEach((li) => {
    li.querySelectorAll(':scope > ul, :scope > ol').forEach((nested) => {
      const d = getMaxDepth(nested, currentDepth + 1);
      if (d > max) max = d;
    });
  });
  return max;
}

export function transformListsForMedium(html) {
  const tempDiv = document.createElement('div');
  tempDiv.innerHTML = html;

  const allLists = tempDiv.querySelectorAll('ul, ol');
  const topLists = Array.from(allLists).filter(list => list.parentElement.closest('ul, ol') === null);

  topLists.forEach((list) => {
    const maxDepth = getMaxDepth(list, 1);
    if (maxDepth === 1) return;

    const depth2Lists = list.querySelectorAll(':scope > li > ul, :scope > li > ol');
    depth2Lists.forEach((nested) => {
      if (nested.tagName === 'OL') {
        const ul = document.createElement('ul');
        while (nested.firstChild) ul.appendChild(nested.firstChild);
        Array.from(nested.attributes).forEach(a => ul.setAttribute(a.name, a.value));
        nested.replaceWith(ul);
        nested = ul;
      }
      
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
             
             currentLi.insertAdjacentElement('afterend', li);
             currentLi = li;
         });
         deepList.remove();
      }
    });

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

export function buildMediumHtml(markdown) {
  let html = marked.parse(preprocessForMedium(markdown));

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
  html = transformListsForMedium(html);
  return html;
}

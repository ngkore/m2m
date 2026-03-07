import { Marked } from 'marked';
import { markedHighlight } from 'marked-highlight';
import hljs from 'highlight.js';


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

marked.setOptions({ gfm: true, breaks: true });

const ADMONITION_TYPE_MAP = {
  NOTE: 'Note',
  IMPORTANT: 'Important',
  WARNING: 'Warning',
  CAUTION: 'Caution',
  TIP: 'Tip',
};

/** Strip YAML front matter from Markdown. */
function stripFrontMatter(markdown) {
  return markdown.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n*/m, '');
}

/** Convert GitHub-style admonitions to Medium italic+bold callouts. */
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

/** Pre-process Markdown for Medium (mirrors client-side preprocessForMedium). */
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
    if (!fnIndexMap[label]) fnIndexMap[label] = ++fnCounter;
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

/** Convert Markdown to Medium-compatible HTML (with full pre-processing). */
export function convertMarkdownToHtml(markdown) {
  return marked.parse(preprocessForMedium(markdown));
}

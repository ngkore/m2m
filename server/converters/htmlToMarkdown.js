import TurndownService from 'turndown';
import { scrapeArticle, parseClientHtml } from '../utils/scraper.js';
import { downloadImages } from '../utils/imageDownloader.js';
import { generateZip } from '../utils/zipGenerator.js';
import slugify from 'slugify';

/** Unwrap Medium outbound redirect URLs to the original destination. */
function unwrapMediumRedirect(href) {
  try {
    const u = new URL(href);
    const host = u.hostname.replace(/^www\./, '');
    if (host === 'medium.com') {
      // /r/?url=encoded
      if (u.pathname === '/r/' && u.searchParams.has('url')) {
        return decodeURIComponent(u.searchParams.get('url'));
      }
      // /m/global-identity?redirectUrl=encoded
      if (u.pathname === '/m/global-identity' && u.searchParams.has('redirectUrl')) {
        return decodeURIComponent(u.searchParams.get('redirectUrl'));
      }
    }
  } catch (_) {}
  return href;
}

/** Resolve remaining Medium redirect links in raw Markdown text. */
function resolveRedirectLinks(markdown) {
  return markdown.replace(
    /\(https?:\/\/(?:www\.)?medium\.com\/r\/\?url=([^)\s]+)\)/g,
    (_, encoded) => {
      try {
        return `(${decodeURIComponent(encoded)})`;
      } catch (_) {
        return `(${encoded})`;
      }
    }
  );
}

/** Unwrap Embedly CDN wrapper URLs to the original source. */
function unwrapEmbedly(src) {
  try {
    const u = new URL(src);
    if (u.hostname === 'cdn.embedly.com') {
      const inner = u.searchParams.get('src') || u.searchParams.get('url') || '';
      // searchParams.get() already decodes — don't double-decode
      if (inner) return inner;
    }
  } catch (_) {}
  return src;
}

/** Resolve an iframe src to a canonical URL (handles Embedly, YouTube, Vimeo, Gist). */
function resolveIframeSrc(src) {
  const resolved = unwrapEmbedly(src);
  const ytMatch = resolved.match(/(?:youtube\.com\/embed\/|youtu\.be\/)([a-zA-Z0-9_-]{11})/);
  if (ytMatch) return `https://www.youtube.com/watch?v=${ytMatch[1]}`;
  const gistMatch = resolved.match(/gist\.github\.com\/([^/]+\/[a-f0-9]+)/);
  if (gistMatch) return `https://gist.github.com/${gistMatch[1]}`;
  const vimeoMatch = resolved.match(/player\.vimeo\.com\/video\/(\d+)/);
  if (vimeoMatch) return `https://vimeo.com/${vimeoMatch[1]}`;
  return unwrapMediumRedirect(resolved);
}

/** Post-process: replace remaining bare Embedly CDN URLs with their original sources. */
function resolveEmbedlyLinks(markdown) {
  return markdown.replace(
    /https?:\/\/cdn\.embedly\.com\/[^\s)"']*/g,
    (embedlyUrl) => resolveIframeSrc(embedlyUrl)
  );
}

/** Custom Turndown rules for Medium HTML elements. */
function createTurndownService() {
  const td = new TurndownService({
    headingStyle: 'atx',
    codeBlockStyle: 'fenced',
    bulletListMarker: '-',
    emDelimiter: '*',
  });

  // Handle Medium figures: images with captions, iframe embeds, tweet embeds,
  // and plain section dividers. Must handle all variants here because Turndown
  // processes the outermost element first (fires before the iframe rule).
  td.addRule('figure', {
    filter: 'figure',
    replacement: (content, node) => {
      const img = node.querySelector('img');

      if (!img) {
        // iframe embed (YouTube, Gist, Vimeo, etc.)
        const iframe = node.querySelector('iframe');
        if (iframe) {
          const src = iframe.getAttribute('src') || '';
          if (!src) return '';
          return `\n\n${resolveIframeSrc(src)}\n\n`;
        }

        // Twitter / X embed────
        const tweet = node.querySelector('blockquote.twitter-tweet, blockquote.twitter-video');
        if (tweet) {
          const links = tweet.querySelectorAll('a');
          const tweetLink = links[links.length - 1];
          const href = tweetLink ? tweetLink.getAttribute('href') || '' : '';
          return href ? `\n\n${href}\n\n` : '';
        }

        // Section divider (figure with no meaningful content)
        return '\n\n---\n\n';
      }

      const figcaption = node.querySelector('figcaption');
      const src = img.getAttribute('src') || '';
      const alt = img.getAttribute('alt') || figcaption?.textContent?.trim() || '';
      const caption = figcaption?.textContent?.trim() || '';

      let md = `![${alt}](${src})`;
      if (caption) {
        md += `\n*${caption}*`;
      }
      return `\n\n${md}\n\n`;
    },
  });

  // Code blocks (pre > code)
  td.addRule('preCode', {
    filter: (node) => {
      return node.nodeName === 'PRE' && node.querySelector('code');
    },
    replacement: (content, node) => {
      const code = node.querySelector('code');
      const text = code.textContent || '';

      // If block contains a ```md fence, unwrap it to plain Markdown
      const innerMdMatch = text.trim().match(/^```(?:md|markdown)\r?\n([\s\S]*?)\r?\n```\s*$/);
      if (innerMdMatch) {
        return `\n\n${innerMdMatch[1].trimEnd()}\n\n`;
      }

      // Preserve language hint from class
      const langMatch = (code.className || '').match(/(?:language-|lang-)(\S+)/);
      const lang = langMatch ? langMatch[1] : '';
      return `\n\n\`\`\`${lang}\n${text}\n\`\`\`\n\n`;
    },
  });

  // Iframes → plain URLs
  td.addRule('iframe', {
    filter: 'iframe',
    replacement: (content, node) => {
      const src = node.getAttribute('src') || '';
      if (!src) return '';
      return `\n\n${resolveIframeSrc(src)}\n\n`;
    },
  });

  // Blockquotes — prefix every line with >
  td.addRule('blockquote', {
    filter: 'blockquote',
    replacement: (content) => {
      const quoted = content
        .trim()
        .split('\n')
        .map((line) => `> ${line}`)
        .join('\n');
      return `\n\n${quoted}\n\n`;
    },
  });

  // Strikethrough: <del>/<s> → ~~text~~
  td.addRule('strikethrough', {
    filter: ['del', 's', 'strike'],
    replacement: (content) => (content ? `~~${content}~~` : ''),
  });

  // Highlights: <mark> → ==text==
  td.addRule('highlight', {
    filter: 'mark',
    replacement: (content) => (content ? `==${content}==` : ''),
  });

  // Superscript: <sup> → ^text^
  td.addRule('superscript', {
    filter: 'sup',
    replacement: (content) => (content ? `^${content}^` : ''),
  });

  // Subscript: <sub> → ~text~
  td.addRule('subscript', {
    filter: 'sub',
    replacement: (content) => (content ? `~${content}~` : ''),
  });

  // Keyboard input: <kbd> → `text`
  td.addRule('kbd', {
    filter: 'kbd',
    replacement: (content) => (content ? `\`${content}\`` : ''),
  });

  // Drop-caps and decorative spans — strip wrapper, keep text
  td.addRule('dropCap', {
    filter: (node) => {
      if (node.nodeName !== 'SPAN') return false;
      const cls = node.getAttribute('class') || '';
      return cls.includes('drop') || cls.includes('graf--dropcap') || cls.includes('first-letter');
    },
    replacement: (content) => content,
  });

  // Links — resolve Medium redirects
  td.addRule('link', {
    filter: (node) => node.nodeName === 'A' && node.getAttribute('href'),
    replacement: (content, node) => {
      const rawHref = node.getAttribute('href') || '';
      const href = resolveIframeSrc(rawHref);
      if (!href || !content.trim()) return content || '';
      return `[${content}](${href})`;
    },
  });


  td.addRule('emptyLink', {
    filter: (node) => {
      return node.nodeName === 'A' && !node.textContent.trim();
    },
    replacement: () => '',
  });

  // Link preview cards — output as plain URLs.
  // Added after 'link' and 'emptyLink' so Turndown checks this rule first
  // (addRule prepends via unshift).
  td.addRule('linkCard', {
    filter: (node) => {
      if (node.nodeName !== 'A' || !node.getAttribute('href')) return false;
      const cls = node.getAttribute('class') || '';
      if (cls.includes('markup--mixtapeEmbed-anchor')) return true;
      return !!node.querySelector('div, h2, h3, h4, p');
    },
    replacement: (content, node) => {
      const rawHref = node.getAttribute('href') || '';
      const href = resolveIframeSrc(rawHref);
      return href ? `\n\n${href}\n\n` : '';
    },
  });

  return td;
}

/** Detect blockquotes with note-like labels and convert to GitHub admonitions. */
function postProcessAdmonitions(markdown) {
  const admonitionMap = {
    note: 'NOTE',
    important: 'IMPORTANT',
    warning: 'WARNING',
    caution: 'CAUTION',
    tip: 'TIP',
  };

  const typePattern = '(Note|Important|Warning|Caution|Tip)';
  const regex = new RegExp(
    `^(> )_?(?:\\*\\*|__)?${typePattern}(?:\\*\\*|__)?:_?\\s*(.*?)_?$`,
    'gim'
  );

  return markdown.replace(regex, (match, prefix, type, content) => {
    const admonitionType = admonitionMap[type.toLowerCase()];
    const cleanContent = content
      .trim()
      .replace(/\*\*(`[^`]+`)\*\*/g, '$1')
      .replace(/__(`[^`]+`)__/g, '$1')
      .replace(/^(\*\*|__|_)/, '')
      .replace(/(\*\*|__|_)$/, '')
      .trim();
    return `> [!${admonitionType}]\n> ${cleanContent}`;
  });
}

/** Unwrap ```md/```markdown fenced blocks back into plain Markdown. */
function unwrapMdCodeBlocks(markdown) {
  return markdown.replace(
    /^```(?:md|markdown)\n([\s\S]*?)^```/gm,
    (match, content) => content.trimEnd()
  );
}

/** Full pipeline: Medium URL → Markdown → ZIP buffer. */
export async function convertMediumUrl(url) {
  const { html, title, author, date } = await scrapeArticle(url);

  const td = createTurndownService();
  let markdown = td.turndown(html);


  markdown = unwrapMdCodeBlocks(markdown);
  markdown = resolveRedirectLinks(markdown);
  markdown = resolveEmbedlyLinks(markdown);
  markdown = postProcessAdmonitions(markdown);


  const escYaml = (s) => s.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  const frontMatter = [
    '---',
    `title: "${escYaml(title)}"`,
    author ? `author: "${escYaml(author)}"` : null,
    date ? `date: "${escYaml(date)}"` : null,
    `source: "${url}"`,
    '---',
  ]
    .filter(Boolean)
    .join('\n');

  markdown = `${frontMatter}\n\n# ${title}\n\n${markdown}`;


  const { markdown: updatedMarkdown, images } = await downloadImages(markdown);


  const slug = slugify(title || 'article', { lower: true, strict: true });
  const zipBuffer = await generateZip(updatedMarkdown, images, slug);

  return { zipBuffer, markdown: updatedMarkdown, slug };
}

export { createTurndownService };

/** Convert client-supplied HTML to Markdown ZIP (fallback for blocked fetches). */
export async function convertHtmlToZip(html, sourceUrl) {
  const { html: articleHtml, title, author, date } = parseClientHtml(html, sourceUrl);

  const td = createTurndownService();
  let markdown = td.turndown(articleHtml);


  markdown = unwrapMdCodeBlocks(markdown);
  markdown = resolveRedirectLinks(markdown);
  markdown = resolveEmbedlyLinks(markdown);
  markdown = postProcessAdmonitions(markdown);

  const escYaml = (s) => s.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  const frontMatter = [
    '---',
    `title: "${escYaml(title)}"`,
    author ? `author: "${escYaml(author)}"` : null,
    date ? `date: "${escYaml(date)}"` : null,
    sourceUrl ? `source: "${sourceUrl}"` : null,
    '---',
  ]
    .filter(Boolean)
    .join('\n');

  markdown = `${frontMatter}\n\n# ${title}\n\n${markdown}`;

  const { markdown: updatedMarkdown, images } = await downloadImages(markdown);
  const slug = slugify(title || 'article', { lower: true, strict: true });
  const zipBuffer = await generateZip(updatedMarkdown, images, slug);

  return { zipBuffer, markdown: updatedMarkdown, slug };
}

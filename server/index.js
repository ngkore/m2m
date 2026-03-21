import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import { randomUUID } from 'crypto';
import { convertMediumUrl, convertHtmlToZip } from './converters/htmlToMarkdown.js';
import { convertMarkdownToHtml } from './converters/markdownToHtml.js';

// In-memory ZIP cache — keyed by one-time token, expires after 15 minutes.
const zipCache = new Map();

setInterval(() => {
  const now = Date.now();
  for (const [key, val] of zipCache) {
    if (val.expiresAt < now) zipCache.delete(key);
  }
}, 60_000);

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json({ limit: '50mb' }));

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.post('/api/fetch-md', async (req, res) => {
  const { url } = req.body;
  if (!url) return res.status(400).json({ error: 'URL is required' });

  let fetchUrl = url;
  let repoContext = null;


  const ghBlobMatch = fetchUrl.match(/^https?:\/\/github\.com\/([^/]+)\/([^/]+)\/blob\/([^/]+)\/(.+)$/);
  if (ghBlobMatch) {
    const [, user, repo, branch, filePath] = ghBlobMatch;
    const dirPath = filePath.includes('/') ? filePath.substring(0, filePath.lastIndexOf('/')) : '';
    fetchUrl = `https://raw.githubusercontent.com/${user}/${repo}/${branch}/${filePath}`;
    repoContext = { host: 'github', user, repo, branch, dirPath };
  }


  const glBlobMatch = fetchUrl.match(/^https?:\/\/gitlab\.com\/([^/]+)\/([^/]+)\/-\/blob\/([^/]+)\/(.+)$/);
  if (glBlobMatch) {
    const [, user, repo, branch, filePath] = glBlobMatch;
    const dirPath = filePath.includes('/') ? filePath.substring(0, filePath.lastIndexOf('/')) : '';
    fetchUrl = fetchUrl.replace('/-/blob/', '/-/raw/');
    repoContext = { host: 'gitlab', user, repo, branch, dirPath };
  }


  if (!repoContext) {
    const rawGhMatch = fetchUrl.match(/^https?:\/\/raw\.githubusercontent\.com\/([^/]+)\/([^/]+)\/([^/]+)\/(.+)$/);
    if (rawGhMatch) {
      const [, user, repo, branch, filePath] = rawGhMatch;
      const dirPath = filePath.includes('/') ? filePath.substring(0, filePath.lastIndexOf('/')) : '';
      repoContext = { host: 'github', user, repo, branch, dirPath };
    }
  }

  try {
    const { default: axios } = await import('axios');
    const response = await axios.get(fetchUrl, {
      headers: { Accept: 'text/plain, text/markdown, */*' },
      timeout: 10000,
      responseType: 'text',
    });

    let content = response.data;

    // Reject HTML responses (not a Markdown file)
    const trimmed = content.trim();
    if (trimmed.startsWith('<!DOCTYPE') || trimmed.startsWith('<html') || trimmed.startsWith('<!doctype')) {
      return res.status(422).json({
        error: 'The URL does not point to a valid Markdown file. It returned an HTML page instead.',
      });
    }


    if (repoContext) {
      content = resolveRelativePaths(content, repoContext);
    }

    res.json({ content, resolvedUrl: fetchUrl });
  } catch (err) {
    res.status(502).json({ error: `Could not fetch: ${err.response?.status || err.message}` });
  }
});

/** Resolve relative paths in Markdown to absolute repository URLs. */
function resolveRelativePaths(markdown, ctx) {
  const { host, user, repo, branch, dirPath } = ctx;

  let blobBase;
  if (host === 'github') {
    blobBase = `https://github.com/${user}/${repo}/blob/${branch}`;
  } else if (host === 'gitlab') {
    blobBase = `https://gitlab.com/${user}/${repo}/-/blob/${branch}`;
  } else {
    return markdown;
  }

  /** Resolve a relative path against the current directory. */
  function resolvePath(relativePath) {

    if (/^https?:\/\//.test(relativePath) || relativePath.startsWith('#')) {
      return null;
    }

    if (/^(data:|mailto:|tel:)/.test(relativePath)) {
      return null;
    }

    let cleaned = relativePath.replace(/^\.\//, '');

    let parts = dirPath ? dirPath.split('/') : [];


    while (cleaned.startsWith('../')) {
      cleaned = cleaned.substring(3);
      parts.pop();
    }

    const resolvedPath = parts.length > 0 ? parts.join('/') + '/' + cleaned : cleaned;
    return resolvedPath;
  }

  // Images: ![alt](relative) or ![alt](relative "title") → absolute
  markdown = markdown.replace(
    /!\[([^\]]*)\]\(([^)\s]+)(\s+"[^"]*")?\)/g,
    (match, alt, href, title) => {
      const resolved = resolvePath(href);
      if (resolved === null) return match;
      return `![${alt}](${blobBase}/${resolved}${title || ''})`;
    }
  );

  // Links: [text](relative) or [text](relative "title") → absolute
  markdown = markdown.replace(
    /(?<!!)\[([^\]]*)\]\(([^)\s]+)(\s+"[^"]*")?\)/g,
    (match, text, href, title) => {
      const [pathPart, ...anchorParts] = href.split('#');
      if (!pathPart) return match; // hash-only link like #section
      const resolved = resolvePath(pathPart);
      if (resolved === null) return match;
      const anchorSuffix = anchorParts.length > 0 ? `#${anchorParts.join('#')}` : '';
      return `[${text}](${blobBase}/${resolved}${anchorSuffix}${title || ''})`;
    }
  );

  // HTML img tags: <img src="relative"> → absolute
  markdown = markdown.replace(
    /<img\s([^>]*?)src=["']([^"']+)["']/gi,
    (match, prefix, src) => {
      const resolved = resolvePath(src);
      if (resolved === null) return match;
      return `<img ${prefix}src="${blobBase}/${resolved}"`;
    }
  );

  return markdown;
}


app.post('/api/convert-url', async (req, res) => {
  const { url } = req.body;

  if (!url) {
    return res.status(400).json({ error: 'URL is required' });
  }

  if (!/^https?:\/\//.test(url)) {
    return res.status(400).json({ error: 'Invalid URL format' });
  }

  try {
    const { zipBuffer, markdown, slug } = await convertMediumUrl(url);

    const token = randomUUID();
    zipCache.set(token, { buffer: zipBuffer, slug, expiresAt: Date.now() + 15 * 60_000 });

    res.json({ markdown, slug, zipToken: token, zipBase64: zipBuffer.toString('base64') });
  } catch (error) {
    console.error('Conversion error:', error.message);

    if (error.message.includes('Unable to fetch') || error.message.includes('All strategies failed')) {
      return res.status(502).json({
        error: 'Could not fetch the article server-side. Medium blocked the request.',
        fallback: 'client-fetch',
      });
    }

    if (error.message.includes('No article content')) {
      return res.status(422).json({ error: 'Could not extract article content from the page.' });
    }

    res.status(500).json({ error: 'An unexpected error occurred during conversion.' });
  }
});


app.post('/api/convert-html', async (req, res) => {
  const { html, sourceUrl } = req.body;

  if (!html) {
    return res.status(400).json({ error: 'HTML content is required' });
  }

  try {
    const { zipBuffer, markdown, slug } = await convertHtmlToZip(html, sourceUrl || '');

    const token = randomUUID();
    zipCache.set(token, { buffer: zipBuffer, slug, expiresAt: Date.now() + 15 * 60_000 });

    res.json({ markdown, slug, zipToken: token, zipBase64: zipBuffer.toString('base64') });
  } catch (error) {
    console.error('HTML conversion error:', error.message);

    if (error.message.includes('No article content')) {
      return res.status(422).json({ error: 'Could not extract article content from the provided HTML.' });
    }

    res.status(500).json({ error: 'An unexpected error occurred during conversion.' });
  }
});


app.post('/api/convert-md', async (req, res) => {
  const { markdown } = req.body;

  if (!markdown) {
    return res.status(400).json({ error: 'Markdown content is required' });
  }

  try {
    const html = convertMarkdownToHtml(markdown);
    res.json({ html });
  } catch (error) {
    console.error('Markdown conversion error:', error.message);
    res.status(500).json({ error: 'Failed to convert Markdown.' });
  }
});

/** Serve a previously-generated ZIP (single-use, expires after 15 min). */
app.get('/api/download-zip/:token', (req, res) => {
  const entry = zipCache.get(req.params.token);
  if (!entry || entry.isPdf) {
    return res.status(404).json({ error: 'ZIP not found or expired. Please convert the article again.' });
  }

  zipCache.delete(req.params.token);

  res.setHeader('Content-Type', 'application/zip');
  res.setHeader('Content-Disposition', `attachment; filename="${entry.slug}.zip"`);
  res.setHeader('Content-Length', entry.buffer.length);
  res.end(entry.buffer);
});

/** Upload a client-generated PDF for secure download fallback. */
app.post('/api/upload-pdf', (req, res) => {
  const { base64Data, filename } = req.body;
  if (!base64Data || !filename) {
    return res.status(400).json({ error: 'Missing PDF data or filename' });
  }

  try {
    const buffer = Buffer.from(base64Data, 'base64');
    const token = randomUUID();
    zipCache.set(token, { buffer, filename, isPdf: true, expiresAt: Date.now() + 15 * 60_000 });
    res.json({ token });
  } catch (err) {
    res.status(500).json({ error: 'Failed to process PDF' });
  }
});

/** Serve a previously-uploaded PDF (single-use). */
app.get('/api/download-pdf/:token', (req, res) => {
  const entry = zipCache.get(req.params.token);
  if (!entry || !entry.isPdf) {
    return res.status(404).json({ error: 'PDF not found or expired.' });
  }

  zipCache.delete(req.params.token);

  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${entry.filename}"`);
  res.setHeader('Content-Length', entry.buffer.length);
  res.end(entry.buffer);
});

// Serve built Vite frontend in production
const __dirname = path.dirname(fileURLToPath(import.meta.url));
app.use(express.static(path.join(__dirname, '../dist')));
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '../dist/index.html'));
});

const HOST = process.env.HOST || '0.0.0.0';
app.listen(PORT, HOST, () => {
  console.log(`✓ M2M API server running on http://${HOST}:${PORT}`);
});

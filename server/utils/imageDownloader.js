import axios from 'axios';
import path from 'path';

// Max simultaneous image downloads — keeps memory under control on Render's free tier
const CONCURRENCY = 3;
// Skip images larger than this (10 MB) to avoid OOM
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

/** Rewrite a Medium CDN image URL to request a high (but not insane) resolution. */
function getHighResUrl(url) {
  try {
    const u = new URL(url);
    if (u.hostname === 'miro.medium.com') {
      u.pathname = u.pathname
        .replace(/\/resize:fit:\d+\//, '/resize:fit:4800/')
        .replace(/\/resize:fill:\d+:\d+\//, '/resize:fit:4800/');
      return u.toString();
    }
    if (/cdn-images-\d+\.medium\.com/.test(u.hostname)) {
      u.pathname = u.pathname.replace(/\/max\/\d+\//, '/max/4800/');
      return u.toString();
    }
  } catch (_) { /* non-URL strings fall through unchanged */ }
  return url;
}

/** Run async tasks with a cap on parallel execution. */
async function pLimit(tasks, limit) {
  const results = new Array(tasks.length).fill(undefined);
  let index = 0;

  async function worker() {
    while (index < tasks.length) {
      const current = index++;
      results[current] = await tasks[current]();
    }
  }

  const workers = Array.from({ length: Math.min(limit, tasks.length) }, worker);
  await Promise.all(workers);
  return results;
}

/** Download images from Markdown, rewrite paths, return updated MD + image buffers. */
export async function downloadImages(markdown) {
  const imageRegex = /!\[([^\]]*)\]\(([^)]+)\)/g;
  const urlMap = new Map();

  let match;
  while ((match = imageRegex.exec(markdown)) !== null) {
    const url = match[2];
    if (!urlMap.has(url) && url.startsWith('http')) {
      urlMap.set(url, null);
    }
  }

  const urlEntries = Array.from(urlMap.keys()).map((url, idx) => ({ url, index: idx + 1 }));
  const imageSlots = new Array(urlEntries.length).fill(null);

  const tasks = urlEntries.map(({ url, index }) => async () => {
    const fetchUrl = getHighResUrl(url);
    try {
      const response = await axios.get(fetchUrl, {
        responseType: 'arraybuffer',
        timeout: 20000,
        maxContentLength: MAX_IMAGE_BYTES,
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        },
      });

      const contentType = response.headers['content-type'] || '';
      let ext = '.jpg';
      if (contentType.includes('png')) ext = '.png';
      else if (contentType.includes('gif')) ext = '.gif';
      else if (contentType.includes('webp')) ext = '.webp';
      else if (contentType.includes('svg')) ext = '.svg';
      else {
        const urlExt = path.extname(new URL(url).pathname).split('?')[0];
        if (['.jpg', '.jpeg', '.png', '.gif', '.webp', '.svg'].includes(urlExt)) {
          ext = urlExt;
        }
      }

      const filename = `image${index}${ext}`;
      urlMap.set(url, filename);
      imageSlots[index - 1] = { filename, buffer: Buffer.from(response.data) };
    } catch (err) {
      console.warn(`Failed to download image: ${fetchUrl} — ${err.message}`);
    }
  });

  await pLimit(tasks, CONCURRENCY);

  const images = imageSlots.filter(Boolean);

  let updatedMarkdown = markdown;
  for (const [url, filename] of urlMap.entries()) {
    if (filename) {
      updatedMarkdown = updatedMarkdown.split(url).join(`./images/${filename}`);
    }
  }

  return { markdown: updatedMarkdown, images };
}

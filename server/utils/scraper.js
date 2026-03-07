import axios from 'axios';
import * as cheerio from 'cheerio';

// Freedium mirrors (env-configurable primary, hardcoded fallback)
const FREEDIUM_MIRRORS = [
  process.env.FREEDIUM_URL || 'https://freedium.cfd',
  'https://freedium-mirror.cfd',
];

// Lazy-init Puppeteer browser (singleton)
let _browser = null;

async function getBrowser() {
  if (_browser) return _browser;

  const puppeteer = (await import('puppeteer-extra')).default;
  const StealthPlugin = (await import('puppeteer-extra-plugin-stealth')).default;
  puppeteer.use(StealthPlugin());

  _browser = await puppeteer.launch({
    headless: true,
    executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
    ],
  });

  return _browser;
}


async function closeBrowser() {
  if (_browser) {
    const b = _browser;
    _browser = null;
    try { await b.close(); } catch (_) {}
  }
}

process.once('exit',    () => { if (_browser) try { _browser.close(); } catch (_) {} });
process.once('SIGINT',  () => closeBrowser().then(() => process.exit(0)));
process.once('SIGTERM', () => closeBrowser().then(() => process.exit(0)));

/**
 * Scrape a Medium article.
 * Strategies: 1) Direct fetch  2) Freedium proxy  3) Puppeteer stealth
 */
export async function scrapeArticle(url) {
  const cleanUrl = url.split('?')[0];
  let html = null;

  // --- Strategy 1: Direct fetch ---
  try {
    const response = await axios.get(cleanUrl, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
        Accept:
          'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
        'Accept-Encoding': 'gzip, deflate, br',
        'Sec-Fetch-Dest': 'document',
        'Sec-Fetch-Mode': 'navigate',
        'Sec-Fetch-Site': 'none',
        'Sec-Fetch-User': '?1',
        'Sec-Ch-Ua': '"Google Chrome";v="131", "Chromium";v="131", "Not_A Brand";v="24"',
        'Sec-Ch-Ua-Mobile': '?0',
        'Sec-Ch-Ua-Platform': '"macOS"',
        'Upgrade-Insecure-Requests': '1',
        'Cache-Control': 'max-age=0',
        Connection: 'keep-alive',
        Referer: 'https://www.google.com/',
      },
      timeout: 20000,
      maxRedirects: 10,
      decompress: true,
    });

    if (response.status === 200 && response.data) {
      html = response.data;
      console.log('Strategy 1 (direct fetch) succeeded');
    }
  } catch (err) {
    console.log(`Strategy 1 failed: ${err.response?.status || err.message}`);
  }

  // Strategy 2: Freedium mirrors
  if (!html) {
    for (const mirror of FREEDIUM_MIRRORS) {
      try {
        const freediumUrl = `${mirror}/${cleanUrl}`;
        const response = await axios.get(freediumUrl, {
          headers: {
            'User-Agent':
              'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
            Accept: 'text/html',
          },
          timeout: 25000,
          maxRedirects: 10,
        });

        if (response.status === 200 && response.data) {
          html = response.data;
          console.log(`Strategy 2 (${mirror}) succeeded`);
          break;
        }
      } catch (err) {
        console.log(`Strategy 2 (${mirror}) failed: ${err.response?.status || err.code || err.message}`);
      }
    }
  }

  // Strategy 3: Puppeteer stealth
  if (!html) {
    let page = null;
    try {
      console.log('Strategy 3: launching Puppeteer stealth browser...');
      const browser = await getBrowser();
      page = await browser.newPage();

      // Block heavy resources to speed up page load
      await page.setRequestInterception(true);
      page.on('request', (req) => {
        const type = req.resourceType();
        if (['image', 'media', 'font', 'stylesheet'].includes(type)) {
          req.abort();
        } else {
          req.continue();
        }
      });

      await page.setViewport({ width: 1280, height: 800 });
      await page.goto(cleanUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });


      await page.waitForSelector('article, main, [data-testid="postContent"]', { timeout: 10000 }).catch(() => {});

      html = await page.content();
      console.log('Strategy 3 (Puppeteer stealth) succeeded');
    } catch (err) {
      console.log(`Strategy 3 (Puppeteer) failed: ${err.message}`);
    } finally {
      if (page) await page.close().catch(() => {});
    }
  }

  if (!html) {
    throw new Error(
      'Unable to fetch the article. All strategies failed. ' +
      'Try opening the article in your browser and using the client-side fallback.'
    );
  }

  return parseArticleHtml(html);
}

/** Parse client-provided HTML (fallback for server-side fetch failures). */
export function parseClientHtml(html, sourceUrl) {
  return parseArticleHtml(html, sourceUrl);
}

/** Extract article content and metadata from HTML. */
function parseArticleHtml(html, sourceUrl = '') {
  const $ = cheerio.load(html);


  const title =
    $('article h1').first().text().trim() ||
    $('h1').first().text().trim() ||
    $('meta[property="og:title"]').attr('content') ||
    $('title').text().trim().replace(/ \|.*$/, '').replace(/ [-–—].*$/, '') ||
    'Untitled Article';


  const author =
    $('meta[name="author"]').attr('content') ||
    $('meta[property="article:author"]').attr('content') ||
    $('a[rel="author"]').first().text().trim() ||
    '';


  const date =
    $('meta[property="article:published_time"]').attr('content') ||
    $('time').first().attr('datetime') ||
    '';


  let articleHtml = '';

  const selectors = [
    'article',
    '.main-content',             // Freedium
    '[data-testid="postContent"]',
    '.postArticle-content',
    '.meteredContent',
    'main section',
    'main',
    '.post-content',
  ];

  for (const selector of selectors) {
    const el = $(selector);
    if (el.length && el.html() && el.html().trim().length > 200) {
      el.find(
        'button, nav, footer, header, ' +
        '[data-testid="headerNav"], [data-testid="publicationFooter"], ' +
        '.js-postMetaLock498, script, style, noscript, ' +
        '.pw-header, .pw-footer, .post-actions, ' +
        '.social-share, .related-posts, .newsletter-signup'
      ).remove();
      articleHtml = el.html();
      break;
    }
  }


  if (!articleHtml) {
    $('section, div').each((_, elem) => {
      const text = $(elem).text().trim();
      if (text.length > 500 && !articleHtml) {
        articleHtml = $(elem).html();
      }
    });
  }

  if (!articleHtml) {
    throw new Error('No article content found on this page.');
  }

  return {
    html: articleHtml,
    title,
    author,
    date,
  };
}

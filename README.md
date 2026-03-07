# M2M

A bidirectional converter between Markdown files and Medium articles.

- **MD → Medium** — write in Markdown, preview as Medium-style HTML, copy to clipboard, and paste directly into the Medium editor. Tables are automatically rendered as images (Medium doesn't support native tables).
- **Medium → MD** — paste a Medium article URL and get a clean Markdown file with all images downloaded at full resolution, packaged as a ZIP.

## Features

- Live Markdown editor with synchronized scroll preview
- Syntax highlighting (highlight.js, github-dark theme)
- GFM table → canvas image conversion with link references
- Markdown reformatter (heading spacing, list normalisation, table alignment)
- Import Markdown from a GitHub / GitLab URL
- GitHub-style admonitions (`> [!NOTE]`, `> [!WARNING]`, …)
- Server-side Medium scraping with three fallback strategies:
  1. Direct axios fetch
  2. Freedium proxy mirrors
  3. Puppeteer + stealth plugin (bypasses bot-detection)
- High-resolution image downloads (Medium CDN rewritten to 4800 px)
- YAML front matter with title, author, date, and source URL
- Light / dark theme with persistence

## Prerequisites

- **Node.js** 18 or later
- **npm** 9 or later

Puppeteer downloads Chromium automatically on `npm install` (~170 MB).

## Getting Started

```bash
# Install dependencies (also downloads Chromium for Puppeteer)
npm install

# Start both the API server (port 3001) and the Vite dev server (port 5173)
npm run dev
```

Then open **http://localhost:5173** in your browser.

### Environment variables

| Variable      | Default     | Description                                                                                              |
| ------------- | ----------- | -------------------------------------------------------------------------------------------------------- |
| `PORT`        | `3001`      | API server port                                                                                          |
| `PORT_CLIENT` | `5173`      | Vite dev server port                                                                                     |
| `HOST`        | `localhost` | Bind address for both servers. Set to `0.0.0.0` to expose on the network (e.g. inside a VM or container) |

## Building for Production

```bash
npm run build   # Vite builds the frontend to dist/
```

The Express server in `server/index.js` serves the API; serve the `dist/` folder with any static file server or proxy requests from your web server.

## Notes on Medium Bot Detection

Medium (and Cloudflare) block plain HTTP requests from Node.js because the TLS fingerprint differs from a real browser. The scraper tries three strategies in order:

1. **Direct axios fetch** — fast, occasionally works on non-paywalled articles.
2. **Freedium mirrors** — proxy services that bypass the paywall. Mirror URLs are configured in `server/utils/scraper.js` and may need updating if they go offline.
3. **Puppeteer stealth** — launches a real Chromium instance with the stealth plugin, which passes all bot-detection checks. Slower (~5–10 s) but reliable.

If all server-side strategies fail, the client automatically tries the Freedium mirrors directly from the browser.

## License

MIT

# M2M

A bidirectional converter between Markdown (`.md`) files and Medium articles.

- **MD → Medium** — write in Markdown, preview as Medium-style HTML, copy to clipboard, and paste directly into the Medium editor. Tables are automatically rendered as images (Medium doesn't support native tables).
- **Medium → MD** — paste a Medium article URL and get a clean Markdown file with all images downloaded at full resolution, packaged as a ZIP.

## Features

**Conversion: Markdown to Medium**

- Real-time Markdown editor with synchronized scroll preview
- Markdown import via local `.md` file upload or raw Git URL (GitHub/GitLab)
- Table bypass: GFM tables are rendered to `<canvas>` and injected as images
- Formatting normalization: Transforms `- [ ]` to Unicode `☐`/`☑` and inline `[^1]` footnotes to `<sup>` with appended references
- Admonition support: Maps blockquotes (`> [!NOTE]`) to Medium callouts
- Syntax highlighting via `highlight.js`
- Markdown reformatting (heading spacing, list normalization, table alignment)
- One-click copy matching Medium's expected clipboard HTML format
- Export preview directly to PDF or standalone HTML

**Conversion: Medium to Markdown**

- Server-side article scraping with three fallback strategies:
  1. Direct HTTP fetch
  2. Freedium proxy mirrors
  3. Puppeteer + stealth plugin (bypasses bot-detection)
- High-resolution image downloads (Medium CDN rewritten to 4800 px)
- YAML front matter with title, author, date, and source URL
- Light / dark theme with persistence

## Prerequisites

- **Node.js** 18 or later
- **npm** 9 or later

## Installation & Setup

1. Install dependencies:

   ```bash
   npm install
   ```

2. Start the API server (port 3001) and Vite dev server (port 5173):

   ```bash
   npm run dev
   ```

3. Access the application at `http://localhost:5173`.

### Environment variables

Create a `.env` file in the root directory (this file is used by both the backend and Docker).

| Variable       | Default                | Description                                                                                              |
| -------------- | ---------------------- | -------------------------------------------------------------------------------------------------------- |
| `PORT`         | `3001`                 | API server port                                                                                          |
| `PORT_CLIENT`  | `5173`                 | Vite dev server port                                                                                     |
| `HOST`         | `localhost`            | Bind address for both servers. Set to `0.0.0.0` to expose on the network (e.g. inside a VM or container) |
| `FREEDIUM_URL` | `https://freedium.cfd` | Primary Freedium mirror for bypassing Medium paywalls                                                    |

## Building for Production

To build the frontend for production:

```bash
npm run build   # Vite builds the frontend to dist/
```

This outputs static files to the `dist/` directory.

## License

Apache 2.0 — see [LICENSE](LICENSE) for details.

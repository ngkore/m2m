import { DOM } from './modules/dom.js';
import { setupUI } from './modules/uiInteractions.js';
import { setupFileUploader } from './modules/fileUpload.js';
import { renderPreview } from './modules/markdownEngine.js';
import { setupExportButtons } from './modules/pdfExport.js';
import { setupMediumScraper } from './modules/mediumScraper.js';

// Initialize all core application modules
setupUI();
setupFileUploader();
setupExportButtons();
setupMediumScraper();

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

if (DOM.markdownInput) {
  DOM.markdownInput.value = EXAMPLE_ARTICLE;
  renderPreview();
}

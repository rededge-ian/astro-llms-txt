# @4hse/astro-llms-txt

An Astro integration to generate AI‑friendly documentation files:

- **`/llms.txt`** – primary index with title, description, and structured links  
- **`/llms-small.txt`** – ultra‑compact version containing only page structure (titles, lists)  
- **`/llms-full.txt`** – full Markdown documentation in a single file  

---

## Installation

```bash
npm install @4hse/astro-llms-txt
# or
yarn add @4hse/astro-llms-txt
```

## Usage

```javascript
import { defineConfig } from 'astro/config';
import astroLlmsTxt from '@4hse/astro-llms-txt';

export default defineConfig({
  site: 'https://www.4hse.com',
  integrations: [
    astroLlmsTxt({
      title: '4HSE',
      description: '4HSE is cloud‑based HSE software that automates workplace safety processes…',
      details: 'Additional context or guidelines.',
      notes: '- This content is auto‑generated from the official source.',
      optionalLinks: [
        {
          label: 'News',
          url: 'https://www.4hse.com/en/news',
          description: 'Latest company news',
        },
      ],
      indexSections: [
        {
          title: 'Documentation',
          include: ['en/docs/**'],
          promote: ['en/docs/getting-started/**'],
        },
        {
          title: 'Blog',
          include: ['en/blog/**'],
          sort: 'date-desc',
        },
      ],
      datePath(pathname) {
        const dates = {
          'en/blog/launch-announcement/': new Date('2025-04-05'),
          'en/blog/product-roadmap/': new Date('2025-02-19'),
        };

        return dates[pathname];
      },
      docSet: [
        {
          title: 'Complete site',
          description: 'The full site of 4HSE',
          url: '/llms-full.txt',
          include: ['en/', 'en/**'],
          promote: ['en/'],
        },
        {
          title: 'Small site',
          description: 'Index of key pages',
          url: '/llms-small.txt',
          include: ['en/', 'en/**'],
          onlyStructure: true,
          promote: ['en/'],
        },
      ],
      pageSeparator: '\n\n---\n\n',
    }),
  ],
});
```

- `onlyStructure`: true makes `llms-small.txt` include only headings and list structure.

- Use `promote`/`demote` with glob patterns for ordering pages.

- Customize `mainSelector` or `ignoreSelectors` when scraping non-standard HTML.

- `indexSections` renders page-level H2 sections in `/llms.txt`. When present, generated doc set links move under `## Optional` together with `optionalLinks`.

- `datePath(pathname)` is only required when an `indexSections` entry uses `sort: 'date-desc'`.

- The homepage (`/`) is automatically excluded from `indexSections`. Prefer narrow include globs such as `blog/**` or `docs/**` instead of broad catch-alls.

## Difference: small vs. full

- `llms-small.txt`: extremely concise—keeps only hierarchy (titles, lists), ideal for agents with limited token budget.

- `llms-full.txt`: exports entire documentation in a single file with full Markdown—suitable for RAG flows, IDEs, or tools that ingest content once.

Both doc set outputs now prepend each page entry with a canonical source URL:

```md
# Page title

> Meta description

URL: https://example.com/docs/page/

Page body in Markdown...
```

## Configuration summary

### llms.txt config

| Property        | Type                             | Description                      |
| --------------- | -------------------------------- | -------------------------------- |
| `title`         | `string`                         | Root H1 header                   |
| `description`   | `string?`                        | Blockquote under title           |
| `details`       | `string?`                        | Expanded guidance paragraphs     |
| `notes`         | `string?`                        | Intro markdown before any H2s    |
| `optionalLinks` | `{ label, url, description }[]?` | Non-essential references         |
| `docSet`        | `DocSet[]?`                      | Sets of documentation files      |
| `indexSections` | `IndexSection[]?`                | H2-grouped per-page link sections |
| `datePath`      | `(pathname) => Date \| undefined` | Date lookup for `date-desc` sort |
| `pageSeparator` | `string?`                        | Custom separator between entries |

### Single DocSet config

| Property          | Type        | Description                             |
| ----------------- | ----------- | --------------------------------------- |
| `title`           | `string`    | Section title                           |
| `description`     | `string`    | Blockquote in each file                 |
| `url`             | `string`    | Output file URL (e.g. `/llms-full.txt`) |
| `include`         | `string[]`  | Glob patterns for pages                 |
| `promote`         | `string[]?` | Globs to push pages higher              |
| `demote`          | `string[]?` | Globs to push pages lower               |
| `onlyStructure`   | `boolean?`  | If true, extracts headings + lists only |
| `mainSelector`    | `string?`   | CSS selector for main HTML root         |
| `ignoreSelectors` | `string[]?` | CSS selectors to skip in HTML to MD     |

### `indexSections` config

| Property    | Type                         | Description                                      |
| ----------- | ---------------------------- | ------------------------------------------------ |
| `title`     | `string`                     | H2 heading in `/llms.txt`                        |
| `include`   | `string[]`                   | Glob patterns for pages to list                  |
| `promote`   | `string[]?`                  | Globs to push pages higher inside the section    |
| `demote`    | `string[]?`                  | Globs to push pages lower inside the section     |
| `sort`      | `'default' \| 'date-desc'?`  | Default ordering or newest-first date ordering   |

## `llms.txt` behavior

- Without `indexSections`, `/llms.txt` keeps the original doc set list as the main index.

- With `indexSections`, `/llms.txt` renders grouped page links first:

  `## Section`

  `- [Page Title](https://example.com/page/): Meta description`

- When `indexSections` is configured, generated doc set links are merged into `## Optional` alongside `optionalLinks`.

- `notes` is emitted as normal intro markdown before any H2 sections, not as a dedicated `## Notes` section.

- The homepage is not included in `indexSections`, even if a glob matches `/`. You should still prefer focused patterns such as `docs/**`, `services/**`, or `blog/**`.

## `datePath` example

Use `datePath` to supply dates for any section that uses `sort: 'date-desc'`. The callback receives the built page pathname and must return a valid `Date`.

```javascript
astroLlmsTxt({
  indexSections: [
    {
      title: 'Blog',
      include: ['blog/**'],
      sort: 'date-desc',
    },
  ],
  datePath(pathname) {
    const frontmatterDates = {
      'blog/launch-announcement/': new Date('2025-04-05'),
      'blog/product-roadmap/': new Date('2025-02-19'),
    };

    return frontmatterDates[pathname];
  },
});
```

If a `date-desc` section matches a page and `datePath` returns `undefined` or an invalid date, the build fails with a clear error.

## Manual verification

1. Configure the integration with:
   - at least one full doc set
   - at least one structure-only doc set
   - one or more `indexSections`
   - one `indexSections` entry using `sort: 'date-desc'`
   - a `datePath(pathname)` callback that covers every page in that dated section
2. Run `pnpm build`.
3. Inspect `dist/llms.txt`:
   - it starts with the H1, optional blockquote, and intro markdown
   - `notes` does not render as `## Notes`
   - each configured `indexSections` block appears as an H2 with per-page links
   - the homepage is absent from those sections
   - generated doc set links appear under `## Optional` when `indexSections` is set
4. Inspect `dist/llms-full.txt`:
   - every entry begins with `# {title}`
   - the description, when present, is on the next blockquote line
   - the next header line is `URL: {canonical}`
   - the body follows after a blank line
5. Inspect `dist/llms-small.txt`:
   - it uses the same entry header shape
   - the body is reduced to headings and lists only
6. Verify date ordering in the `date-desc` section:
   - newest pages appear first
   - ties fall back to deterministic ordering
7. Break one dated page on purpose:
   - return `undefined` or an invalid `Date` from `datePath`
   - rerun the build and confirm it fails with the page pathname in the error

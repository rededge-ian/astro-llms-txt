# @4hse/astro-llms-txt

An Astro integration to generate AI‑friendly documentation files:

- **`/llms.txt`** – primary index with title, description, and structured links  
- **`/llms-small.txt`** – compact companion docset that keeps page headings and list structure  
- **`/llms-full.txt`** – full companion docset with obvious presentational noise removed  

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

- `onlyStructure: true` makes `llms-small.txt` keep `h2`-`h6`, `ul`, `ol`, `li`, and their text from the page body.

- If the homepage/root page matches a doc set, it is included, emitted first, and rendered as file-level lead-in context instead of as a synthetic `# Page title` entry.

- `llms-full.txt` keeps useful text and links but strips obvious noise such as HTML comments, bare images, linked images, and hidden/purely visual elements where practical.

- Use `promote`/`demote` with glob patterns for ordering pages.

- Customize `mainSelector` or `ignoreSelectors` when scraping non-standard HTML.

- `indexSections` renders page-level H2 sections in `/llms.txt`. When present, generated doc set links move under `## Optional` together with `optionalLinks`.

- `datePath(pathname)` is only required when an `indexSections` entry uses `sort: 'date-desc'`.

- The homepage (`/`) is automatically excluded from `indexSections`. Prefer narrow include globs such as `blog/**` or `docs/**` instead of broad catch-alls.

- Public URLs are built from Astro's explicit `site` and `base` config. This integration does not try to infer a final hostname from Wrangler, Cloudflare previews, `workers.dev`, or custom domains.

## Docset behavior

- `llms-small.txt`: keeps compact page structure from the body content by preserving headings and lists.

- `llms-full.txt`: keeps full page text and meaningful links, while removing obvious presentational noise.

- If the homepage matches a doc set, it is always placed first and rendered as intro context without a synthetic `# {title}` heading.

- Non-homepage entries keep the normal per-page shape:

```md
# Page title

> Meta description

URL: https://example.com/docs/page/

Page body in Markdown...
```

- Homepage entries in `llms-full.txt` and `llms-small.txt` look like this instead:

```md
<SYSTEM>Doc set summary</SYSTEM>

> Homepage description

URL: https://example.com/docs/

Homepage body in Markdown...
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
| `description`     | `string`    | Summary written into the file-level `<SYSTEM>...</SYSTEM>` block |
| `url`             | `string`    | Output file path (e.g. `/llms-full.txt`) |
| `include`         | `string[]`  | Glob patterns for pages                 |
| `promote`         | `string[]?` | Globs to push pages higher              |
| `demote`          | `string[]?` | Globs to push pages lower               |
| `onlyStructure`   | `boolean?`  | If true, keeps `h2`-`h6` plus list structure from the page body |
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

- The homepage is not included in `indexSections`, even if a glob matches `/` or `**`. You should still prefer focused patterns such as `docs/**`, `services/**`, or `blog/**`.

## Canonical URLs

- Page `URL:` lines and generated doc set links are built from Astro's configured `site` and `base`.

- If `site` is `https://example.com` and `base` is `/product/`, generated URLs look like `https://example.com/product/docs/page/`.

- This package does not inspect Wrangler config or infer preview/custom hostnames automatically.

- If you need environment-specific hostnames, set `site` and `base` explicitly for that build environment.

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
   - the homepage appears first if it matches the doc set
   - the homepage does not begin with `# {title}`
   - the homepage still includes its description, `URL:`, and body content
   - non-homepage entries still begin with `# {title}`
   - HTML comments, image-only lines, linked-image lines, and hidden visual fragments are removed where practical
5. Inspect `dist/llms-small.txt`:
   - the homepage uses the same intro treatment with no synthetic H1
   - non-homepage entries still use the normal `# {title}` page heading
   - the body keeps meaningful `h2`-`h6` headings and lists from the page content
6. Verify date ordering in the `date-desc` section:
   - newest pages appear first
   - ties fall back to deterministic ordering
7. Break one dated page on purpose:
   - return `undefined` or an invalid `Date` from `datePath`
   - rerun the build and confirm it fails with the page pathname in the error

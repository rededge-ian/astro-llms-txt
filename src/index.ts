import type { AstroConfig, AstroIntegration } from "astro";
import type { Element, Root, RootContent } from "hast";
import fs from "fs/promises";
import { select } from "hast-util-select";
import path from "path";
import micromatch from "micromatch";
import rehypeParse from "rehype-parse";
import { unified } from "unified";
import { entryToSimpleMarkdown } from "./entryToSimpleMarkdown";

interface DocSet {
  title: string;
  description: string;
  url: string;
  include: string[];
  promote?: string[];
  demote?: string[];
  onlyStructure?: boolean;
  mainSelector?: string; // default "main"
  ignoreSelectors?: string[];
}

interface IndexSection {
  title: string;
  include: string[];
  promote?: string[];
  demote?: string[];
  sort?: "default" | "date-desc";
}

interface LlmsConfig {
  title: string;
  description?: string;
  details?: string;
  optionalLinks?: Array<{ label: string; url: string; description?: string }>;
  docSet?: DocSet[];
  notes?: string;
  pageSeparator?: string;
  indexSections?: IndexSection[];
  datePath?: (pathname: string) => Date | undefined;
}

interface ParsedPage {
  pathname: string;
  htmlPath: string;
  canonical: string;
  description?: string;
  document: Root;
}

interface PageExcerpt {
  pathname: string;
  canonical: string;
  description?: string;
  main: Element;
  title: string;
}

interface PluginContext {
  config: LlmsConfig;
  astroConfig: AstroConfig;
  distDir: string;
  pages: { pathname: string }[];
  pageCache: Map<string, Promise<ParsedPage | null>>;
}

const htmlDocumentParser = unified().use(rehypeParse);

/**
 * Astro integration to generate a llms.txt file containing documentation sets.
 * @param configOptions
 * @returns
 */
export default function astroLlmsTxt(configOptions: LlmsConfig): AstroIntegration {
  let astroConfig: AstroConfig;

  return {
    name: "astro-llms-txt",
    hooks: {
      "astro:config:setup": ({ config }) => {
        astroConfig = config;
      },
      "astro:build:done": async ({ dir, pages }) => {
        if (!configOptions.pageSeparator) {
          configOptions.pageSeparator = "\n\n---\n\n";
        }

        const context: PluginContext = {
          config: configOptions,
          astroConfig,
          distDir: dir.pathname,
          pages: pages.map(page => ({ pathname: page.pathname })),
          pageCache: new Map(),
        };

        const collator = new Intl.Collator(astroConfig.i18n?.defaultLocale || "en");
        const docSetLines = await processAllDocSets(context, collator);
        const indexSectionBlocks = await buildIndexSections(context, collator);
        const llmsTxt = buildLlmsIndex(configOptions, docSetLines, indexSectionBlocks);

        await fs.writeFile(path.join(context.distDir, "llms.txt"), llmsTxt, "utf-8");
        console.log("✅ llms.txt generated");
      },
    },
  };
}

/**
 * Process all documentation sets defined in the configuration.
 * @param context
 * @param collator
 * @returns
 */
async function processAllDocSets(
  context: PluginContext,
  collator: Intl.Collator,
): Promise<string[]> {
  const lines: string[] = [];
  const { config, astroConfig } = context;

  for (const set of config.docSet ?? []) {
    await processDocSet({ set, context, collator });
    const url = resolvePublicUrl(set.url, astroConfig);
    lines.push(`- [${set.title}](${url}): ${set.description}`);
  }

  return lines;
}

/**
 * Process a single documentation set.
 * @param args
 */
async function processDocSet(args: {
  context: PluginContext;
  collator: Intl.Collator;
  set: DocSet;
}): Promise<void> {
  const { context, collator, set } = args;
  const { distDir, config } = context;
  const matches = getMatchedPathnames(context.pages, set.include);
  const sorted = sortDocSetPathnames(matches, collator, set.promote, set.demote);
  const entries: string[] = [];

  for (const pathname of sorted) {
    const page = await getParsedPage(context, pathname);
    if (!page) continue;

    const entry = await buildEntryFromPage(
      page,
      set.mainSelector,
      set.ignoreSelectors,
      set.onlyStructure ?? false,
      { suppressTitleHeading: isRootPathname(pathname) },
    );
    entries.push(entry);
  }

  const outPath = path.join(distDir, set.url.replace(/^\//, ""));
  await fs.mkdir(path.dirname(outPath), { recursive: true });

  const content = `<SYSTEM>${set.description}</SYSTEM>\n\n` + entries.join(config.pageSeparator);
  await fs.writeFile(outPath, content, "utf-8");
  console.log(`✅ DocSet "${set.title}" generated at ${outPath}`);
}

async function buildIndexSections(
  context: PluginContext,
  collator: Intl.Collator,
): Promise<string[]> {
  const blocks: string[] = [];

  for (const section of context.config.indexSections ?? []) {
    const matches = getMatchedPathnames(context.pages, section.include)
      .filter(pathname => !isRootPathname(pathname));

    const entries = await Promise.all(
      matches.map(async pathname => {
        const page = await getParsedPage(context, pathname);
        return page ? buildPageExcerpt(page) : null;
      }),
    );

    const availableEntries = entries.filter((entry): entry is PageExcerpt => entry !== null);
    const sortedEntries = sortIndexSectionEntries(availableEntries, section, context, collator);

    if (!sortedEntries.length) continue;

    const lines = sortedEntries.map(entry =>
      renderLinkLine(entry.title, entry.canonical, entry.description),
    );
    blocks.push(`## ${section.title}\n\n${lines.join("\n")}`);
  }

  return blocks;
}

/**
 * Build a single entry from a parsed page.
 * @param page
 * @param onlyStructure
 * @returns
 */
async function buildEntryFromPage(
  page: ParsedPage,
  mainSelector: string = "main",
  ignoreSelectors: string[] = [],
  onlyStructure: boolean,
  options: { suppressTitleHeading?: boolean } = {},
): Promise<string> {
  const excerpt = buildPageExcerpt(page, mainSelector);
  const markdown = await entryToSimpleMarkdown(
    excerpt.main,
    ["h1", "footer", "header", ...ignoreSelectors],
    onlyStructure,
  );

  const parts: string[] = [];
  if (!options.suppressTitleHeading) parts.push(`# ${excerpt.title}`);
  if (excerpt.description) parts.push(`> ${excerpt.description}`);
  parts.push(`URL: ${excerpt.canonical}`);
  if (markdown.trim()) parts.push(markdown.trim());

  return parts.join("\n\n");
}

/**
 * Build the final llms.txt index content.
 * @param opts Configuration options for the index.
 * @param docSetLines Lines representing documentation sets.
 * @param indexSectionBlocks Rendered H2 sections for page links.
 * @returns The formatted llms.txt content.
 */
function buildLlmsIndex(
  opts: LlmsConfig,
  docSetLines: string[],
  indexSectionBlocks: string[],
): string {
  const usingIndexSections = Array.isArray(opts.indexSections);
  const optionalLines = [
    ...(usingIndexSections ? docSetLines : []),
    ...(opts.optionalLinks ?? []).map(link =>
      renderLinkLine(link.label, link.url, link.description),
    ),
  ];

  const lines: string[] = [
    `# ${opts.title}`,
    opts.description ? `> ${opts.description}` : "",
    opts.details ?? "",
    opts.notes ?? "",
  ];

  if (usingIndexSections) {
    lines.push(...indexSectionBlocks);
  } else if (docSetLines.length) {
    lines.push("## Documentation Sets\n\n" + docSetLines.join("\n"));
  }

  if (optionalLines.length) {
    lines.push("## Optional\n\n" + optionalLines.join("\n"));
  }

  return lines.filter(Boolean).join("\n\n");
}

function buildPageExcerpt(page: ParsedPage, mainSelector: string = "main"): PageExcerpt {
  const main = select(mainSelector, page.document);
  if (!isElement(main)) {
    throw new Error(`Missing main selector <${mainSelector}> for ${page.pathname}`);
  }

  const h1 = select("h1", main);

  return {
    pathname: page.pathname,
    canonical: page.canonical,
    description: page.description,
    main,
    title: getTextContent(h1).trim() || "Untitled",
  };
}

async function getParsedPage(
  context: PluginContext,
  pathname: string,
): Promise<ParsedPage | null> {
  const cached = context.pageCache.get(pathname);
  if (cached) return cached;

  const promise = loadParsedPage(context, pathname);
  context.pageCache.set(pathname, promise);
  return promise;
}

async function loadParsedPage(
  context: PluginContext,
  pathname: string,
): Promise<ParsedPage | null> {
  const htmlPath = getHtmlPath(context.distDir, pathname);

  try {
    const html = await fs.readFile(htmlPath, "utf-8");
    const document = htmlDocumentParser.parse(html) as Root;

    return {
      pathname,
      htmlPath,
      canonical: resolvePublicUrl(pathname, context.astroConfig),
      description: getMetaContent(select('meta[name="description"]', document)),
      document,
    };
  } catch (error) {
    if (isMissingFileError(error)) {
      if (!is404Pathname(pathname)) {
        console.warn(`⚠️ Skipping page with missing HTML: ${htmlPath}`);
      }

      return null;
    }

    throw error;
  }
}

function sortIndexSectionEntries(
  entries: PageExcerpt[],
  section: IndexSection,
  context: PluginContext,
  collator: Intl.Collator,
): PageExcerpt[] {
  const sortedEntries = [...entries];

  if (section.sort === "date-desc") {
    const { datePath } = context.config;
    if (!datePath) {
      throw new Error('indexSections with sort "date-desc" require a datePath(pathname) callback.');
    }

    const datedEntries = sortedEntries.map(entry => ({
      entry,
      date: requireValidDate(datePath(entry.pathname), entry.pathname),
    }));

    datedEntries.sort((a, b) => {
      const leftPriority = getPathPriority(a.entry.pathname, section.promote, section.demote);
      const rightPriority = getPathPriority(b.entry.pathname, section.promote, section.demote);
      if (leftPriority !== rightPriority) return rightPriority - leftPriority;

      const dateDiff = b.date.getTime() - a.date.getTime();
      if (dateDiff !== 0) return dateDiff;

      const titleDiff = collator.compare(a.entry.title, b.entry.title);
      if (titleDiff !== 0) return titleDiff;

      return collator.compare(a.entry.pathname, b.entry.pathname);
    });

    return datedEntries.map(item => item.entry);
  }

  return sortedEntries.sort((a, b) =>
    comparePathPriority(a.pathname, b.pathname, section.promote, section.demote, collator),
  );
}

function sortPathnames(
  pathnames: string[],
  collator: Intl.Collator,
  promote: string[] = [],
  demote: string[] = [],
): string[] {
  return [...pathnames].sort((a, b) =>
    comparePathPriority(a, b, promote, demote, collator),
  );
}

function sortDocSetPathnames(
  pathnames: string[],
  collator: Intl.Collator,
  promote: string[] = [],
  demote: string[] = [],
): string[] {
  const sorted = sortPathnames(pathnames, collator, promote, demote);
  return [
    ...sorted.filter(pathname => isRootPathname(pathname)),
    ...sorted.filter(pathname => !isRootPathname(pathname)),
  ];
}

function comparePathPriority(
  left: string,
  right: string,
  promote: string[] = [],
  demote: string[] = [],
  collator: Intl.Collator,
): number {
  const leftPriority = getPathPriority(left, promote, demote);
  const rightPriority = getPathPriority(right, promote, demote);

  if (leftPriority !== rightPriority) {
    return rightPriority - leftPriority;
  }

  return collator.compare(left, right);
}

function getPathPriority(
  pathname: string,
  promote: string[] = [],
  demote: string[] = [],
): number {
  const demoted = demote.findIndex(expr => matchesPathname(pathname, expr));
  const promoted = demoted > -1
    ? -1
    : promote.findIndex(expr => matchesPathname(pathname, expr));

  return (
    (promoted > -1 ? promote.length - promoted : 0)
    + demote.length - demoted - 1
  );
}

function getMatchedPathnames(
  pages: { pathname: string }[],
  include: string[],
): string[] {
  return [...new Set(
    pages
      .map(page => page.pathname)
      .filter(pathname => !isExcludedPathname(pathname))
      .filter(pathname => include.some(pattern => matchesPathname(pathname, pattern))),
  )];
}

function renderLinkLine(label: string, url: string, description?: string): string {
  return `- [${label}](${url})${description ? `: ${description}` : ""}`;
}

function getHtmlPath(distDir: string, pathname: string): string {
  if (isRootPathname(pathname)) {
    return path.join(distDir, "index.html");
  }

  if (is404Pathname(pathname)) {
    return path.join(distDir, "404.html");
  }

  return path.join(distDir, pathname.replace(/^\/+|\/+$/g, ""), "index.html");
}

function getSiteUrl(astroConfig: AstroConfig): URL {
  if (!astroConfig.site) {
    throw new Error('astro-llms-txt requires Astro "site" to generate absolute llms.txt URLs.');
  }

  return typeof astroConfig.site === "string" ? new URL(astroConfig.site) : astroConfig.site;
}

function resolvePublicUrl(pathname: string, astroConfig: AstroConfig): string {
  if (isAbsoluteUrl(pathname)) {
    return new URL(pathname).toString();
  }

  return new URL(buildPublicPath(pathname, astroConfig.base), getSiteUrl(astroConfig)).toString();
}

function buildPublicPath(pathname: string, base: string = "/"): string {
  const normalizedBase = normalizeBasePath(base);
  const normalizedPathname = normalizePublicPathname(pathname);

  if (normalizedBase === "/") return normalizedPathname;
  if (normalizedPathname === "/") return normalizedBase;
  return `${normalizedBase.replace(/\/$/, "")}${normalizedPathname}`;
}

function normalizeBasePath(base: string): string {
  if (!base || base === "/") return "/";
  return `/${base.replace(/^\/+|\/+$/g, "")}/`;
}

function normalizePublicPathname(pathname: string): string {
  if (isRootPathname(pathname)) return "/";
  return `/${pathname.replace(/^\/+/, "")}`;
}

function matchesPathname(pathname: string, pattern: string): boolean {
  return micromatch.isMatch(isRootPathname(pathname) ? "/" : pathname, pattern);
}

function isRootPathname(pathname: string): boolean {
  return pathname === "" || pathname === "/";
}

function isExcludedPathname(pathname: string): boolean {
  return is404Pathname(pathname);
}

function is404Pathname(pathname: string): boolean {
  return pathname.replace(/^\/+|\/+$/g, "") === "404";
}

function isAbsoluteUrl(value: string): boolean {
  return /^[a-zA-Z][a-zA-Z\d+\-.]*:/.test(value);
}

function isMissingFileError(error: unknown): error is NodeJS.ErrnoException {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}

function requireValidDate(date: Date | undefined, pathname: string): Date {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) {
    throw new Error(`Missing valid date for "${pathname}" in indexSections sort "date-desc".`);
  }

  return date;
}

function isElement(node: RootContent | null | undefined): node is Element {
  return node?.type === "element";
}

function getMetaContent(node: RootContent | null | undefined): string | undefined {
  if (!isElement(node)) return undefined;

  const content = node.properties?.content;
  return typeof content === "string" ? content.trim() || undefined : undefined;
}

function getTextContent(node: RootContent | null | undefined): string {
  if (!node) return "";
  if (node.type === "text") return collapseWhitespace(node.value);
  if ("children" in node && Array.isArray(node.children)) {
    return joinTextChildren(node.children as RootContent[]);
  }
  return "";
}

function joinTextChildren(children: RootContent[]): string {
  let text = "";
  let pendingWhitespace = false;
  let previousNode: RootContent | null = null;
  let previousText = "";

  for (const child of children) {
    const childText = getTextContent(child);
    if (!childText.trim()) {
      pendingWhitespace ||= /\s/.test(childText);
      continue;
    }

    const leadingWhitespace = /^\s/.test(childText);
    const trailingWhitespace = /\s$/.test(childText);
    const trimmedText = childText.trim();

    if (previousNode && shouldInsertTextBoundarySpace(
      previousNode,
      child,
      previousText.at(-1),
      trimmedText.at(0),
      pendingWhitespace || leadingWhitespace,
    )) {
      text += " ";
    }

    text += trimmedText;
    previousNode = child;
    previousText = trimmedText;
    pendingWhitespace = trailingWhitespace;
  }

  return text;
}

function shouldInsertTextBoundarySpace(
  previousNode: RootContent,
  nextNode: RootContent,
  previousChar: string | undefined,
  nextChar: string | undefined,
  requestedByWhitespace: boolean,
): boolean {
  if (!previousChar || !nextChar) return false;
  if (/[),.;:!?%\]}»”’]/u.test(nextChar)) return false;
  if (/[(\[{«“‘]/u.test(previousChar)) return false;

  if (requestedByWhitespace) {
    return true;
  }

  return (
    isElement(previousNode)
    && isElement(nextNode)
    && /[\p{L}\p{N}]/u.test(previousChar)
    && /[\p{L}\p{N}]/u.test(nextChar)
  );
}

function collapseWhitespace(value: string): string {
  return value.replace(/\s+/g, " ");
}

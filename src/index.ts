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
  mainSelector?: string; //default "main"
  ignoreSelectors?: string[];
}

interface LlmsConfig {
  title: string;
  description?: string;
  details?: string;
  optionalLinks?: Array<{ label: string; url: string; description?: string }>;
  docSet?: DocSet[];
  notes?: string;
  pageSeparator?: string;
}

interface PluginContext {
  config: LlmsConfig;
  astroConfig: AstroConfig;
  distDir: string;
  pages: { pathname: string }[];
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

        const context : PluginContext = {
          config: configOptions,
          astroConfig,
          distDir: dir.pathname,
          pages: pages.map(page => ({ pathname: page.pathname })),
        };

        const allDocSetsContent = await processAllDocSets(context);
        const llmsTxt = buildLlmsIndex(configOptions, allDocSetsContent);

        await fs.writeFile(path.join(context.distDir, "llms.txt"), llmsTxt, "utf-8");
        console.log("✅ llms.txt generated");
      },
    },
  };
}

/**
 * Process all documentation sets defined in the configuration.
 * @param context 
 * @returns 
 */
async function processAllDocSets(context : PluginContext): Promise<string[]> {
  const lines: string[] = [];
  const { config, astroConfig } = context;

  const collator = new Intl.Collator(astroConfig.i18n?.defaultLocale || 'en');

  for (const set of config.docSet ?? []) {
    await processDocSet({ set, context, collator });
    const url = new URL(set.url, astroConfig.site);
    lines.push(`- [${set.title}](${url}): ${set.description}`);
  }

  return lines;
}

/**
 * Process a single documentation set.
 * @param args 
 */
async function processDocSet(args: {
  context: PluginContext,
  collator: Intl.Collator,
  set: DocSet
}): Promise<void> {
  const { context, collator, set } = args;
  const { distDir, pages, config } = context;

  const matches = pages
    .map(p => p.pathname)
    .filter(pn =>
      set.include.some(pat => micromatch.isMatch(pn, pat))
    );

  const sorted = matches.sort((a, b) => {
    const pa = prioritizePathname(a, set.promote, set.demote);
    const pb = prioritizePathname(b, set.promote, set.demote);
    return collator.compare(pa, pb);
  });

  const entries: string[] = [];

  for (const pn of sorted) {
    const htmlPath = path.join(distDir, pn.replace(/\/$/, ""), "index.html");
    try {
      await fs.access(htmlPath);
      const entry = await buildEntryFromHtml(htmlPath, set.mainSelector, set.ignoreSelectors, set.onlyStructure ?? false);
      entries.push(entry);
    } catch {
      console.error(`❌ File not found: ${htmlPath}`);
    }
  }

  const outPath = path.join(distDir, set.url.replace(/^\//, ""));
  await fs.mkdir(path.dirname(outPath), { recursive: true });

  const content = `<SYSTEM>${set.description}</SYSTEM>\n\n` + entries.join(config.pageSeparator);
  await fs.writeFile(outPath, content, "utf-8");
  console.log(`✅ DocSet "${set.title}" generated at ${outPath}`);
}

/**
 * Build a single entry from an HTML file.
 * @param htmlPath 
 * @param onlyStructure
 * @returns 
 */
async function buildEntryFromHtml(
  htmlPath: string, 
  mainSelector: string = 'main', 
  ignoreSelectors: string[] = [],
  onlyStructure: boolean,
): Promise<string> {
  const html = await fs.readFile(htmlPath, "utf-8");
  const document = htmlDocumentParser.parse(html) as Root;
  const main = select(mainSelector, document);
  if (!isElement(main)) throw new Error(`Missing main selector <${mainSelector}>`);

  const h1 = select("h1", main);
  const title = getTextContent(h1).trim() || "Untitled";
  const metaDesc = getMetaContent(select('meta[name="description"]', document));

  const markdown = await entryToSimpleMarkdown(
    main,
    ['h1','footer','header', ...ignoreSelectors],
    onlyStructure,
  );

  const parts = [`# ${title}`];
  if (metaDesc) parts.push(`> ${metaDesc}`);
  parts.push(markdown.trim());

  return parts.join("\n\n");
}

/**
 * Build the final llms.txt index content.
 * @param opts Configuration options for the index.
 * @param docSetsLines Lines representing documentation sets.
 * @returns The formatted llms.txt content.
 */
function buildLlmsIndex(
  opts: LlmsConfig,
  docSetsLines: string[]
): string {
  const lines: string[] = [
    `# ${opts.title}`,
    opts.description ? `> ${opts.description}` : "",
    opts.details ?? ""
  ];

  if (docSetsLines.length) {
    lines.push("## Documentation Sets\n\n" + docSetsLines.join("\n"));
  }

  if (opts.notes) {
    lines.push("## Notes\n\n" + opts.notes);
  }

  if (opts.optionalLinks?.length) {
    lines.push(
      "## Optional\n\n" +
      opts.optionalLinks
        .map(l => `- [${l.label}](${l.url})${l.description ? `: ${l.description}` : ""}`)
        .join("\n")
    );
  }

  return lines.filter(Boolean).join("\n\n");
}

/**
 * Prioritize a pathname based on promotion and demotion patterns.
 * @param id 
 * @param promote 
 * @param demote 
 * @returns 
 */
function prioritizePathname(id: string, promote: string[] = [], demote: string[] = []) {
  const demoted = demote.findIndex(expr => micromatch.isMatch(id, expr));
  const promoted = demoted > -1
    ? -1
    : promote.findIndex(expr => micromatch.isMatch(id, expr));
  const prefixLength =
    (promoted > -1 ? promote.length - promoted : 0)
    + demote.length - demoted - 1;
  return '_'.repeat(prefixLength) + id;
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
  if (node.type === "text") return node.value;
  if ("children" in node && Array.isArray(node.children)) {
    return node.children.map(child => getTextContent(child as RootContent)).join("");
  }
  return "";
}

import type { Element, ElementContent, Root, RootContent } from "hast";
import { matches } from "hast-util-select";
import rehypeParse from "rehype-parse";
import rehypeRemark from "rehype-remark";
import remarkGfm from "remark-gfm";
import remarkStringify from "remark-stringify";
import { unified } from "unified";

const structureSelectors = ["h2", "h3", "h4", "h5", "h6", "ul", "ol", "li"];
const noisySelectors = [
  "img",
  "picture",
  "source",
  "svg",
  "canvas",
  "script",
  "style",
  "template",
  "noscript",
  "[hidden]",
  "[aria-hidden='true']",
];

type MarkdownInput = string | Root | RootContent;

interface FilterContext {
  ignoreSelectors: string[];
  insideStructure: boolean;
  onlyStructure: boolean;
}

const htmlFragmentParser = unified().use(rehypeParse, { fragment: true });
const markdownStringifier = unified()
  .use(rehypeRemark)
  .use(remarkGfm)
  .use(remarkStringify);

function normalizeTree(input: MarkdownInput): Root {
  if (typeof input === "string") {
    return htmlFragmentParser.parse(input) as Root;
  }

  const subtree: Root = input.type === "root"
    ? input
    : { type: "root", children: [input] };
  return structuredClone(subtree);
}

function filterTree(root: Root, context: Omit<FilterContext, "insideStructure">): Root {
  const children = root.children
    .map(node => filterNode(node as RootContent, { ...context, insideStructure: false }))
    .filter((node): node is RootContent => node !== null);

  return { ...root, children };
}

function filterNode(node: RootContent, context: FilterContext): RootContent | null {
  if (node.type === "comment") {
    return null;
  }

  if (node.type === "text") {
    if (context.onlyStructure && !context.insideStructure) {
      return null;
    }

    return structuredClone(node);
  }

  if (!isElement(node)) {
    return null;
  }

  if (shouldDropElement(node, context.ignoreSelectors)) {
    return null;
  }

  const isStructural = structureSelectors.some(selector => matches(selector, node));
  const insideStructure = context.insideStructure || isStructural;
  const children = node.children
    .map(child => filterNode(child, { ...context, insideStructure }))
    .filter((child): child is ElementContent => child !== null);

  if (!children.length) {
    return null;
  }

  if (!context.onlyStructure) {
    return { ...node, children };
  }

  if (isStructural || context.insideStructure) {
    return { ...node, children };
  }

  return children.length ? { ...node, children } : null;
}

function shouldDropElement(node: Element, ignoreSelectors: string[]): boolean {
  return [...ignoreSelectors, ...noisySelectors].some(selector => matches(selector, node));
}

function cleanupMarkdown(markdown: string): string {
  const lines = markdown
    .replace(/<!--[\s\S]*?-->/g, "")
    .split("\n")
    .filter(line => !isDecorativeMarkdownLine(line));

  return lines.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

function isDecorativeMarkdownLine(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed) return false;

  const withoutListMarker = trimmed.replace(/^(?:[-*+]\s+|\d+\.\s+)/, "");
  return (
    /^(?:!\[[^\]]*]\([^)\n]+\)|\[!\[[^\]]*]\([^)\n]+\)]\([^)\n]+\))$/.test(withoutListMarker)
    || /^\[\]\([^)\n]+\)$/.test(withoutListMarker)
  );
}

function isElement(node: RootContent | null | undefined): node is Element {
  return node?.type === "element";
}

/** Render html content to Markdown to support rendering and simplifying MDX components */
export async function entryToSimpleMarkdown(
  html: MarkdownInput,
  ignoreSelectors: string[] = [],
  onlyStructure: boolean = false,
) {
  const tree = filterTree(normalizeTree(html), { ignoreSelectors, onlyStructure });
  const markdownTree = await markdownStringifier.run(tree);
  const markdown = String(markdownStringifier.stringify(markdownTree)).trim();
  return cleanupMarkdown(markdown);
}

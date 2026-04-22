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
  "iframe",
  "script",
  "style",
  "template",
  "noscript",
  "[hidden]",
  "[aria-hidden='true']",
];
const whitespaceSensitiveTags = new Set(["code", "pre", "textarea"]);
const blockLikeTags = new Set([
  "address",
  "article",
  "aside",
  "blockquote",
  "body",
  "details",
  "div",
  "dl",
  "dt",
  "dd",
  "fieldset",
  "figcaption",
  "figure",
  "footer",
  "form",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "header",
  "hr",
  "html",
  "li",
  "main",
  "nav",
  "ol",
  "p",
  "pre",
  "section",
  "table",
  "tbody",
  "td",
  "tfoot",
  "th",
  "thead",
  "tr",
  "ul",
]);
const ancillaryEmbedTextPatterns = [
  /\bprefer the source\b/i,
  /\bview (?:the )?(?:instagram|facebook|tiktok|twitter|x|linkedin) (?:post|video|thread|source)\b/i,
  /\bview (?:this )?(?:post|video|thread) on (?:instagram|facebook|tiktok|twitter|x|linkedin)\b/i,
  /\bview on (?:instagram|facebook|tiktok|twitter|x|linkedin)\b/i,
  /\bwatch (?:the )?(?:video|clip) on (?:youtube|tiktok)\b/i,
];
const ancillaryEmbedClassPattern = /\b(?:instagram-media|twitter-tweet|tiktok-embed|facebook-post)\b/i;
const ancillaryEmbedWrapperTags = new Set(["aside", "blockquote", "div", "figcaption", "figure", "p"]);
const socialHostPattern = /(?:^|\.)((?:instagram|facebook|tiktok|twitter|x|linkedin|youtube))\.com$/i;

type MarkdownInput = string | Root | RootContent;
type HtmlNode = RootContent | ElementContent;

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
  return (
    [...ignoreSelectors, ...noisySelectors].some(selector => matches(selector, node))
    || isAncillarySocialEmbedElement(node)
  );
}

function isAncillarySocialEmbedElement(node: Element): boolean {
  if (!ancillaryEmbedWrapperTags.has(node.tagName)) {
    return false;
  }

  const className = getClassName(node);
  if (className && ancillaryEmbedClassPattern.test(className)) {
    return true;
  }

  const text = getNodeTextContent(node).replace(/\s+/g, " ").trim();
  if (!text || text.length > 180) return false;
  if (!ancillaryEmbedTextPatterns.some(pattern => pattern.test(text))) return false;

  return getDescendantHrefs(node).some(href => isSocialEmbedHref(href));
}

function getClassName(node: Element): string {
  const className = node.properties?.className;

  if (Array.isArray(className)) {
    return className.filter((value): value is string => typeof value === "string").join(" ");
  }

  return typeof className === "string" ? className : "";
}

function getDescendantHrefs(node: Element): string[] {
  const hrefs: string[] = [];
  const visit = (current: HtmlNode) => {
    if (!isElement(current)) return;

    const href = current.properties?.href;
    if (typeof href === "string") hrefs.push(href);

    for (const child of current.children) {
      visit(child as HtmlNode);
    }
  };

  visit(node);
  return hrefs;
}

function isSocialEmbedHref(href: string): boolean {
  if (!/^(?:https?:)?\/\//i.test(href)) return false;

  try {
    return socialHostPattern.test(new URL(href).hostname);
  } catch {
    return false;
  }
}

function getNodeTextContent(node: HtmlNode | null | undefined): string {
  if (!node) return "";
  if (node.type === "text") return node.value;
  if (!isElement(node)) return "";

  return node.children.map(child => getNodeTextContent(child as HtmlNode)).join("");
}

function normalizeWhitespaceTree(root: Root): Root {
  return normalizeParent(root);
}

function normalizeParent<T extends Root | Element>(parent: T): T {
  if (parent.type === "element" && whitespaceSensitiveTags.has(parent.tagName)) {
    return parent;
  }

  const children = parent.children
    .map(child => normalizeHtmlNode(child as HtmlNode))
    .filter((child): child is HtmlNode => child !== null);

  const normalizedChildren = shouldNormalizeInlineSequence(children)
    ? normalizeInlineChildren(children)
    : normalizeBlockChildren(children);

  return { ...parent, children: normalizedChildren as T["children"] };
}

function normalizeHtmlNode(node: HtmlNode): HtmlNode | null {
  if (node.type === "text") {
    return { ...node, value: collapseWhitespace(node.value) };
  }

  if (!isElement(node)) {
    return null;
  }

  const normalized = normalizeParent(node);
  return normalized.children.length ? normalized : null;
}

function shouldNormalizeInlineSequence(children: HtmlNode[]): boolean {
  const meaningfulChildren = children.filter(child => !isBlankTextNode(child));
  return meaningfulChildren.length > 0 && meaningfulChildren.every(isInlineLikeNode);
}

function normalizeInlineChildren(children: HtmlNode[]): HtmlNode[] {
  const normalized: HtmlNode[] = [];
  let pendingWhitespace = false;

  for (const child of children) {
    const leadingWhitespace = hasLeadingBoundaryWhitespace(child);
    const trailingWhitespace = hasTrailingBoundaryWhitespace(child);
    const trimmedChild = trimBoundaryWhitespace(child);

    if (!trimmedChild) {
      pendingWhitespace ||= leadingWhitespace || trailingWhitespace;
      continue;
    }

    const previous = normalized.at(-1);
    if (previous && shouldInsertBoundarySpace(previous, trimmedChild, pendingWhitespace || leadingWhitespace)) {
      appendTextNode(normalized, " ");
    }

    appendHtmlNode(normalized, trimmedChild);
    pendingWhitespace = trailingWhitespace;
  }

  return normalized;
}

function normalizeBlockChildren(children: HtmlNode[]): HtmlNode[] {
  const normalized: HtmlNode[] = [];

  for (const child of children) {
    if (child.type === "text") {
      const value = collapseWhitespace(child.value).trim();
      if (!value) continue;

      appendHtmlNode(normalized, { ...child, value });
      continue;
    }

    appendHtmlNode(normalized, child);
  }

  return normalized;
}

function trimBoundaryWhitespace(node: HtmlNode): HtmlNode | null {
  return trimRightBoundary(trimLeftBoundary(node));
}

function trimLeftBoundary(node: HtmlNode | null): HtmlNode | null {
  if (!node) return null;

  if (node.type === "text") {
    const value = collapseWhitespace(node.value).replace(/^\s+/, "");
    return value ? { ...node, value } : null;
  }

  if (!isElement(node) || whitespaceSensitiveTags.has(node.tagName)) {
    return node;
  }

  const children = [...node.children] as HtmlNode[];
  while (children.length) {
    const trimmedChild = trimLeftBoundary(children[0] ?? null);
    if (trimmedChild) {
      children[0] = trimmedChild;
      break;
    }

    children.shift();
  }

  return children.length ? { ...node, children: children as ElementContent[] } : null;
}

function trimRightBoundary(node: HtmlNode | null): HtmlNode | null {
  if (!node) return null;

  if (node.type === "text") {
    const value = collapseWhitespace(node.value).replace(/\s+$/, "");
    return value ? { ...node, value } : null;
  }

  if (!isElement(node) || whitespaceSensitiveTags.has(node.tagName)) {
    return node;
  }

  const children = [...node.children] as HtmlNode[];
  while (children.length) {
    const index = children.length - 1;
    const trimmedChild = trimRightBoundary(children[index] ?? null);
    if (trimmedChild) {
      children[index] = trimmedChild;
      break;
    }

    children.pop();
  }

  return children.length ? { ...node, children: children as ElementContent[] } : null;
}

function hasLeadingBoundaryWhitespace(node: HtmlNode): boolean {
  const text = getLeadingText(node);
  return !!text && /^\s/.test(text);
}

function hasTrailingBoundaryWhitespace(node: HtmlNode): boolean {
  const text = getTrailingText(node);
  return !!text && /\s$/.test(text);
}

function getLeadingText(node: HtmlNode | null | undefined): string | undefined {
  if (!node) return undefined;
  if (node.type === "text") return collapseWhitespace(node.value);
  if (!isElement(node)) return undefined;

  for (const child of node.children) {
    const text = getLeadingText(child as HtmlNode);
    if (text !== undefined) return text;
  }

  return undefined;
}

function getTrailingText(node: HtmlNode | null | undefined): string | undefined {
  if (!node) return undefined;
  if (node.type === "text") return collapseWhitespace(node.value);
  if (!isElement(node)) return undefined;

  for (let index = node.children.length - 1; index >= 0; index -= 1) {
    const text = getTrailingText(node.children[index] as HtmlNode);
    if (text !== undefined) return text;
  }

  return undefined;
}

function shouldInsertBoundarySpace(
  previous: HtmlNode,
  next: HtmlNode,
  requestedByWhitespace: boolean,
): boolean {
  const previousChar = getTrailingBoundaryChar(previous);
  const nextChar = getLeadingBoundaryChar(next);
  if (!previousChar || !nextChar) return false;
  if (isTightFollowingPunctuation(nextChar) || isTightLeadingPunctuation(previousChar)) return false;

  if (requestedByWhitespace) {
    return true;
  }

  return (
    isInlineElement(previous)
    && isInlineElement(next)
    && isWordLike(previousChar)
    && isWordLike(nextChar)
  );
}

function getLeadingBoundaryChar(node: HtmlNode): string | undefined {
  return getLeadingText(node)?.trimStart().at(0);
}

function getTrailingBoundaryChar(node: HtmlNode): string | undefined {
  return getTrailingText(node)?.trimEnd().at(-1);
}

function isTightFollowingPunctuation(char: string): boolean {
  return /[),.;:!?%\]}»”’]/u.test(char);
}

function isTightLeadingPunctuation(char: string): boolean {
  return /[(\[{«“‘]/u.test(char);
}

function isWordLike(char: string): boolean {
  return /[\p{L}\p{N}]/u.test(char);
}

function isInlineLikeNode(node: HtmlNode): boolean {
  if (node.type === "text") return true;
  return isElement(node) && !blockLikeTags.has(node.tagName);
}

function isInlineElement(node: HtmlNode): node is Element {
  return isElement(node) && !blockLikeTags.has(node.tagName);
}

function isBlankTextNode(node: HtmlNode): boolean {
  return node.type === "text" && !collapseWhitespace(node.value).trim();
}

function appendHtmlNode(nodes: HtmlNode[], node: HtmlNode): void {
  if (node.type === "text") {
    appendTextNode(nodes, node.value);
    return;
  }

  nodes.push(node);
}

function appendTextNode(nodes: HtmlNode[], value: string): void {
  if (!value) return;

  const previous = nodes.at(-1);
  if (previous?.type === "text") {
    previous.value += value;
    return;
  }

  nodes.push({ type: "text", value });
}

function collapseWhitespace(value: string): string {
  return value.replace(/\s+/g, " ");
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
  const tree = normalizeWhitespaceTree(
    filterTree(normalizeTree(html), { ignoreSelectors, onlyStructure }),
  );
  const markdownTree = await markdownStringifier.run(tree);
  const markdown = String(markdownStringifier.stringify(markdownTree)).trim();
  return cleanupMarkdown(markdown);
}

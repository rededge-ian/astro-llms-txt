import type { Root, RootContent } from 'hast';
import { matches } from 'hast-util-select';
import rehypeParse from 'rehype-parse';
import rehypeRemark from 'rehype-remark';
import remarkGfm from 'remark-gfm';
import remarkStringify from 'remark-stringify';
import { unified } from 'unified';
import { remove } from 'unist-util-remove';

/**
 * Selector to get for minification
 */
const structureSelectors = ['h2','h3','h4','h5','h6','ul','ol','li'];

type MarkdownInput = string | Root | RootContent;

const htmlFragmentParser = unified().use(rehypeParse, { fragment: true });

const htmlToMarkdownPipeline = unified()

	.use(function removeSomeElements() {
		return (tree, file) => {
			remove(tree, (_node) => {
				const node = _node as RootContent;
				const data = file.data as { ignoreSelectors: string[] };
				for (const selector of data.ignoreSelectors) {
					if (matches(selector, node)) {
						return true;
					}
				}
				return false;
			});
			return tree;
		};
	})

	.use(function keepOnlyStructure() {
		return (tree, file) => {
			if (!file.data.onlyStructure) return tree;
			remove(tree, (_node) => {
				const node = _node as RootContent;
				return !structureSelectors.some(sel => matches(sel, node));
			});
			return tree;
		};
	})
	.use(rehypeRemark)
	.use(remarkGfm)
	.use(remarkStringify);

function normalizeTree(input: MarkdownInput): Root {
	if (typeof input === 'string') {
		return htmlFragmentParser.parse(input) as Root;
	}

	const subtree = input.type === 'root' ? input : { type: 'root', children: [input] };
	return structuredClone(subtree);
}

/** Render html content to Markdown to support rendering and simplifying MDX components */
export async function entryToSimpleMarkdown(
	html: MarkdownInput,
 	ignoreSelectors: string[] = [],
	onlyStructure: boolean = false,
) {
	const file = { data: { onlyStructure, ignoreSelectors } } as Parameters<
		typeof htmlToMarkdownPipeline.run
	>[1];
	const markdownTree = await htmlToMarkdownPipeline.run(normalizeTree(html), file);
	let markdown = String(htmlToMarkdownPipeline.stringify(markdownTree, file)).trim();
	//if (onlyStructure) {
	//	markdown = markdown.replace(/\s+/g, ' ');
	//}
	return markdown;
}

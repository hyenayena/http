// The only file importing the HTML libraries. Turns a page into compact Markdown for a reader with
// limited room (the assistant's context): keeps the main content, drops scripts, menus and forms.
import {NodeHtmlMarkdown} from 'node-html-markdown';
import {parse, type HTMLElement} from 'node-html-parser';

export type HtmlToMarkdownOptions = {
	/** Resolves relative links and images; usually the response's final URL. */
	baseUrl?: string | URL;
};

export type PageMarkdown = {
	title?: string;
	markdown: string;
};

const HTML_TYPE = /^(text\/html|application\/xhtml\+xml)\b/i;
const HTML_START = /^\s*(<!--[\s\S]*?-->\s*)*(<!doctype\s+html|<html[\s>])/i;

/** True for an HTML content type, or with no type for a body that starts like an HTML document. */
export function isHtml(contentType: string | undefined, text?: string): boolean {
	if (contentType) return HTML_TYPE.test(contentType.trim());
	return text !== undefined && HTML_START.test(text.slice(0, 4096));
}

const DROPPED = [
	'script', 'style', 'noscript', 'template', 'svg', 'canvas', 'iframe', 'object', 'embed',
	'form', 'button', 'input', 'select', 'textarea', 'dialog',
	'nav', 'footer', 'aside', '[role=navigation]', '[role=banner]', '[role=contentinfo]', '[role=search]',
	'[role=menu]', '[role=menubar]', '[role=dialog]', '[aria-modal=true]', '[aria-hidden=true]', '[hidden]',
	'[class*=dropdown]', '.mw-editsection', 'img:not([alt])', 'img[alt=""]',
].join(',');

const MAIN = ['main', '[role=main]', 'article'];

const converter = new NodeHtmlMarkdown({bulletMarker: '-', maxConsecutiveNewlines: 2, keepDataImages: false});

function contentRoot(doc: HTMLElement): HTMLElement {
	for (const selector of MAIN) {
		const found = doc.querySelectorAll(selector);
		// Several <article>s are usually a feed of cards, not the page's one article.
		if (found.length === 1 && found[0]!.textContent.trim()) return found[0]!;
	}
	return doc.querySelector('body') ?? doc;
}

// Tables used for page layout (nested tables, role=presentation) become plain blocks: Markdown
// tables cannot nest and would bury the text in pipes.
function unwrapLayoutTables(root: HTMLElement): void {
	for (const table of root.querySelectorAll('table')) {
		if (table.getAttribute('role') !== 'presentation' && !table.querySelector('table')) continue;
		const own = table.querySelectorAll('thead,tbody,tfoot,tr,td,th,caption').filter(el => el.closest('table') === table);
		for (const el of [table, ...own]) el.tagName = 'div';
	}
}

function absolutize(root: HTMLElement, base: URL | undefined): void {
	for (const [selector, attr] of [['a', 'href'], ['img', 'src']] as const) {
		for (const el of root.querySelectorAll(selector)) {
			el.removeAttribute('title');
			const value = el.getAttribute(attr);
			if (!base || !value || value.startsWith('#') || /^[a-z][a-z\d+.-]*:/i.test(value)) continue;
			try {
				el.setAttribute(attr, new URL(value, base).href);
			} catch {
				// A broken link stays as written.
			}
		}
	}
}

// Dropped icons and line breaks in the HTML leave spaces at the edges of link text (`[Telegram ](…)`),
// and the library pads every table cell to its column width, which can cost more than the HTML.
function tidy(markdown: string): string {
	let fenced = false;
	return markdown
		.split('\n')
		.map(line => {
			if (/^\s*(```|~~~)/.test(line)) fenced = !fenced;
			if (fenced) return line;
			const trimmed = line.replace(/\[([^\[\]\n]*)\]\(/g, (_, text: string) => `[${text.trim()}](`);
			if (!trimmed.startsWith('|')) return trimmed;
			return trimmed.replace(/ {2,}\|/g, ' |').replace(/-{4,}/g, '---');
		})
		.join('\n');
}

function parseBase(baseUrl: string | URL | undefined): URL | undefined {
	if (baseUrl === undefined) return undefined;
	try {
		return new URL(baseUrl);
	} catch {
		return undefined;
	}
}

export function htmlToMarkdown(html: string, options: HtmlToMarkdownOptions = {}): PageMarkdown {
	const doc = parse(html, {comment: false, blockTextElements: {script: false, style: false, noscript: false, pre: true}});
	const title = doc.querySelector('title')?.textContent.replace(/\s+/g, ' ').trim();
	const root = contentRoot(doc);
	for (const el of root.querySelectorAll(DROPPED)) el.remove();
	unwrapLayoutTables(root);
	absolutize(root, parseBase(options.baseUrl));
	const markdown = tidy(converter.translate(root.innerHTML)).trim();
	return {...(title && {title}), markdown};
}

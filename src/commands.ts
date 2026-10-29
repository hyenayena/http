import {readFile, stat} from 'node:fs/promises';
import path from 'node:path';
import type {Command, OptionDoc, Subcommand} from '../../../src/api.js';
import {isMethod, parseCall} from './args.js';
import type {HttpClient} from './client/client.js';
import {HttpError, HTTP_METHODS, type HttpResponse} from './client/types.js';
import {htmlToMarkdown, isHtml} from './html/markdown.js';
import {sanitizeBlock} from './kit.js';

export type CommandDeps = {
	client: () => HttpClient;
	cwd?: string;
};

export const MAX_BODY_FILE = 1024 * 1024;
export const MAX_RESPONSE = 4 * 1024 * 1024;
export const MAX_SHOWN = 20 * 1024;

const OPTIONS = '[-H name:value]… [--json] [-i] [--raw] [--from <n>] [--timeout <s>]';
const WITH_BODY = new Set(['POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS']);
const USAGE = 'http <method> <url> [options]';

const OPTION_DOCS: OptionDoc[] = [
	{name: '-H', aliases: ['--header'], value: 'name:value', description: 'Send this request header', repeatable: true},
	{name: '--json', description: 'Send and accept JSON; a body must be valid JSON'},
	{name: '-i', aliases: ['--include'], description: 'Show the response headers'},
	{name: '--raw', description: 'Show an HTML page as its source, not as Markdown'},
	{name: '--from', value: '<n>', description: 'Show the text from this character on (the next part of a long one)'},
	{name: '--timeout', value: '<s>', description: 'Give up after this many seconds (1 to 600)'},
];
const BODY_DOCS: OptionDoc[] = [
	{name: '--file', value: '<path>', description: 'Send this file as the body (up to 1 MiB)'},
	{name: '--data', aliases: ['-d'], value: '<text…>', description: 'Send the rest of the line as the body'},
];
const URL_ARG = {name: 'url', description: 'An http or https address; private addresses are refused'};
const NOTES = ['HTML pages are shown as Markdown; long text comes in parts, the footer gives the next --from'];

const subcommands: Subcommand[] = HTTP_METHODS.map(m => {
	const name = m.toLowerCase();
	const body = WITH_BODY.has(m);
	return {
		name,
		usage: `http ${name} <url> ${OPTIONS}${body ? ' [--file <path> | --data <text…>]' : ''}`,
		description: m === 'OPTIONS' ? 'Send an OPTIONS request' : `Send a ${m} request`,
		args: [URL_ARG],
		options: body ? [...OPTION_DOCS, ...BODY_DOCS] : OPTION_DOCS,
		agent: 'confirm' as const,
	};
});

const TEXTUAL = /^(text\/|application\/([\w.+-]*\+)?(json|xml|javascript|x-www-form-urlencoded|yaml|graphql))/i;

const formatSize = (bytes: number): string =>
	bytes < 1024 ? `${bytes} B` : bytes < 1024 * 1024 ? `${(bytes / 1024).toFixed(1)} KiB` : `${(bytes / 1024 / 1024).toFixed(1)} MiB`;

function isText(res: HttpResponse): boolean {
	const type = res.headers['content-type'];
	if (type) return TEXTUAL.test(type.trim());
	return !res.body.includes(0);
}

export type FormatOptions = {include?: boolean; raw?: boolean; from?: number};

export function formatResponse(res: HttpResponse, {include = false, raw = false, from = 0}: FormatOptions = {}): string[] {
	const lines = [sanitizeBlock(`HTTP ${res.status}${res.statusText ? ` ${res.statusText}` : ''} · ${formatSize(res.body.length)} · ${res.ms} ms`)];
	if (res.redirects > 0) lines.push(sanitizeBlock(`Redirected ${res.redirects}× to ${res.url}`));
	if (include) for (const [name, value] of Object.entries(res.headers)) lines.push(sanitizeBlock(`${name}: ${value}`));
	if (res.body.length === 0) return lines;
	lines.push('');
	if (!isText(res)) {
		lines.push(`(binary body, ${formatSize(res.body.length)}, not shown)`);
		return lines;
	}
	let text = res.text();
	if (!raw && isHtml(res.headers['content-type'], text)) {
		try {
			const page = htmlToMarkdown(text, {baseUrl: res.url});
			lines.push(`(HTML converted to Markdown, ${formatSize(res.body.length)} -> ${formatSize(Buffer.byteLength(page.markdown))}; --raw shows the source)`);
			if (page.title) lines.push(sanitizeBlock(`Title: ${page.title}`));
			lines.push('');
			text = page.markdown;
		} catch (err) {
			lines.push(sanitizeBlock(`(HTML could not be converted: ${err instanceof Error ? err.message : String(err)}; showing the source)`), '');
		}
	}
	const part = pageOf(text, from);
	if (from > 0) {
		if (part.text === '') {
			lines.push(`(nothing from character ${from}: the text has ${text.length})`);
			return lines;
		}
		lines.push(`(characters ${from}-${part.end} of ${text.length})`, '');
	}
	lines.push(sanitizeBlock(part.text));
	if (part.end < text.length) lines.push(`… ${text.length - part.end} more characters; the next part: --from ${part.end}`);
	return lines;
}

function pageOf(text: string, from: number): {text: string; end: number} {
	if (from >= text.length) return {text: '', end: text.length};
	let end = Math.min(text.length, from + MAX_SHOWN);
	if (end < text.length) {
		const br = text.lastIndexOf('\n', end);
		if (br > from + MAX_SHOWN / 2) end = br + 1;
	}
	return {text: text.slice(from, end).replace(/\n$/, ''), end};
}

async function readBodyFile(file: string, cwd: string): Promise<Uint8Array> {
	const full = path.resolve(cwd, file);
	const info = await stat(full).catch(() => undefined);
	if (!info?.isFile()) throw new Error(`No such file: ${file}`);
	if (info.size > MAX_BODY_FILE) throw new Error(`Body file is larger than ${formatSize(MAX_BODY_FILE)}`);
	return new Uint8Array(await readFile(full));
}

export function createCommand(deps: CommandDeps): Command {
	return {
		name: 'http',
		description: 'Send HTTP requests to public addresses',
		usage: USAGE,
		args: [
			{name: 'method', description: 'get, head, post, put, patch, delete or options'},
			URL_ARG,
			{name: 'options', description: 'See the help of a method, e.g. http get help'},
		],
		notes: NOTES,
		subcommands,
		agent: 'confirm',
		run: async ([sub, ...args], ctx) => {
			if (sub === undefined || sub === 'help') return ctx.showHelp ? ctx.showHelp() : ctx.print(USAGE);
			if (!isMethod(sub)) throw new Error(`Unknown subcommand "${sub.slice(0, 32)}". Run "http help".`);
			const call = parseCall(sub.toUpperCase() as Parameters<typeof parseCall>[0], args);
			if ((call.data !== undefined || call.file !== undefined) && !WITH_BODY.has(call.method)) {
				throw new Error(`${call.method} requests cannot have a body`);
			}
			let body: string | Uint8Array | undefined = call.data;
			if (call.file !== undefined) body = await readBodyFile(call.file, deps.cwd ?? process.cwd());
			if (call.json && body !== undefined) {
				try {
					JSON.parse(typeof body === 'string' ? body : new TextDecoder().decode(body));
				} catch {
					throw new Error('"--json" body is not valid JSON');
				}
			}
			const headers = {...call.headers};
			if (call.json) {
				const has = (name: string) => Object.keys(headers).some(h => h.toLowerCase() === name);
				if (!has('content-type') && body !== undefined) headers['content-type'] = 'application/json';
				if (!has('accept')) headers.accept = 'application/json';
			}
			try {
				const res = await deps.client().request({
					method: call.method,
					url: call.url,
					headers,
					maxBytes: MAX_RESPONSE,
					...(body !== undefined && {body}),
					...(call.timeoutMs !== undefined && {timeoutMs: call.timeoutMs}),
					...(ctx.signal && {signal: ctx.signal}),
				});
				for (const line of formatResponse(res, {include: call.include, raw: call.raw, ...(call.from !== undefined && {from: call.from})})) ctx.print(line);
			} catch (err) {
				if (err instanceof HttpError) throw new Error(sanitizeBlock(err.message));
				throw err;
			}
		},
	};
}

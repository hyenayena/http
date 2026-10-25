import {HTTP_METHODS, type HttpMethod} from './client/types.js';

export type ParsedCall = {
	method: HttpMethod;
	url: string;
	headers: Record<string, string>;
	json: boolean;
	include: boolean;
	raw: boolean;
	timeoutMs?: number;
	data?: string;
	file?: string;
};

export const isMethod = (word: string): word is HttpMethod => (HTTP_METHODS as readonly string[]).includes(word.toUpperCase());

/**
 * Parses `<url> [-H name:value]… [--json] [-i] [--raw] [--timeout <s>] [--file <path> | --data <text…>]`.
 * The console splits lines on whitespace, so `--data` takes the rest of the line joined by single spaces.
 */
export function parseCall(method: HttpMethod, args: readonly string[]): ParsedCall {
	const call: ParsedCall = {method, url: '', headers: {}, json: false, include: false, raw: false};
	for (let i = 0; i < args.length; i++) {
		const arg = args[i]!;
		const value = () => {
			const next = args[++i];
			if (next === undefined) throw new Error(`"${arg}" needs a value`);
			return next;
		};
		switch (arg) {
			case '-H':
			case '--header': {
				const raw = value();
				const at = raw.indexOf(':');
				if (at <= 0) throw new Error(`Header must look like name:value, got "${raw.slice(0, 64)}"`);
				call.headers[raw.slice(0, at)] = raw.slice(at + 1).trim();
				break;
			}
			case '--json':
				call.json = true;
				break;
			case '-i':
			case '--include':
				call.include = true;
				break;
			case '--raw':
				call.raw = true;
				break;
			case '--timeout': {
				const seconds = Number(value());
				if (!Number.isFinite(seconds) || seconds <= 0 || seconds > 600) throw new Error('"--timeout" takes seconds, from 1 to 600');
				call.timeoutMs = Math.round(seconds * 1000);
				break;
			}
			case '--file':
				call.file = value();
				break;
			case '--data':
			case '-d':
				call.data = args.slice(i + 1).join(' ');
				i = args.length;
				break;
			default:
				if (arg.startsWith('-')) throw new Error(`Unknown option "${arg.slice(0, 32)}"`);
				if (call.url) throw new Error('Give one URL');
				call.url = arg;
		}
	}
	if (!call.url) throw new Error('Missing URL');
	if (call.data !== undefined && call.file !== undefined) throw new Error('Give either "--data" or "--file", not both');
	return call;
}

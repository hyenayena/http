import type {Logger} from '../../../../src/api.js';
import {ipLiteral, isBlockedAddress} from './address.js';
import {
	HttpError,
	type HttpMethod,
	type HttpRequest,
	type HttpResponse,
	type HttpResult,
	type RequestOptions,
	type Transport,
} from './types.js';

export type ClientDefaults = {
	headers?: Record<string, string>;
	timeoutMs?: number;
	maxBytes?: number;
	redirects?: number;
	throwOnStatus?: boolean;
};

export type HttpClientOptions = {
	transport: Transport;
	/** Must match how the transport was created; it guards IP literals, the transport guards names. */
	allowPrivate?: boolean;
	/** Relative request URLs are resolved against it. */
	baseUrl?: string;
	defaults?: ClientDefaults;
	log?: Logger;
};

export type BatchOptions = {
	/** Requests in flight at once; default 6. */
	concurrency?: number;
	/** Cancels every request not finished yet. */
	signal?: AbortSignal;
};

export type HttpClient = {
	request(req: HttpRequest): Promise<HttpResponse>;
	get(url: string | URL, options?: RequestOptions): Promise<HttpResponse>;
	head(url: string | URL, options?: RequestOptions): Promise<HttpResponse>;
	options(url: string | URL, options?: RequestOptions): Promise<HttpResponse>;
	delete(url: string | URL, options?: RequestOptions): Promise<HttpResponse>;
	post(url: string | URL, options?: RequestOptions): Promise<HttpResponse>;
	put(url: string | URL, options?: RequestOptions): Promise<HttpResponse>;
	patch(url: string | URL, options?: RequestOptions): Promise<HttpResponse>;
	/** Runs the requests in parallel (bounded); results keep the input order and never reject. */
	all(requests: readonly HttpRequest[], options?: BatchOptions): Promise<HttpResult[]>;
	/** Runs the requests one after another; results keep the input order and never reject. */
	sequence(requests: readonly HttpRequest[], options?: Omit<BatchOptions, 'concurrency'>): Promise<HttpResult[]>;
	close(): Promise<void>;
};

export const DEFAULTS = {
	timeoutMs: 30_000,
	maxBytes: 10 * 1024 * 1024,
	redirects: 5,
	userAgent: 'yena-http',
} as const;

const TOKEN = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/;
const BAD_VALUE = new RegExp('[\\u0000-\\u0008\\u000a-\\u001f\\u007f]');
// Dropped when a redirect leaves the origin, as browsers and curl do.
const ORIGIN_BOUND = ['authorization', 'cookie', 'proxy-authorization'];
const BODY_HEADERS = ['content-type', 'content-length', 'content-encoding', 'transfer-encoding'];

const invalid = (message: string) => new HttpError('invalid-request', message);

const decoder = new TextDecoder();

function normaliseHeaders(...sets: (Record<string, string> | undefined)[]): Record<string, string> {
	const out: Record<string, string> = {};
	for (const set of sets) {
		for (const [name, value] of Object.entries(set ?? {})) {
			if (!TOKEN.test(name)) throw invalid(`Invalid header name "${name.slice(0, 64)}"`);
			if (typeof value !== 'string' || BAD_VALUE.test(value)) throw invalid(`Invalid value for header "${name}"`);
			out[name.toLowerCase()] = value;
		}
	}
	return out;
}

function buildUrl(input: string | URL, baseUrl: string | undefined, query: HttpRequest['query']): URL {
	let url: URL;
	try {
		url = new URL(input, baseUrl);
	} catch {
		throw invalid('Invalid URL');
	}
	if (url.protocol !== 'http:' && url.protocol !== 'https:') throw invalid(`Unsupported protocol "${url.protocol}"`);
	if (url.username || url.password) throw invalid('Credentials in the URL are not allowed; send an Authorization header');
	for (const [key, raw] of Object.entries(query ?? {})) {
		for (const value of Array.isArray(raw) ? raw : [raw]) {
			if (value !== undefined) url.searchParams.append(key, String(value));
		}
	}
	return url;
}

function checkTarget(url: URL, allowPrivate: boolean): void {
	if (allowPrivate) return;
	const ip = ipLiteral(url.hostname);
	if (ip !== undefined && isBlockedAddress(ip)) throw new HttpError('blocked', `Refused to connect to a private address (${ip})`);
}

function makeResponse(url: URL, status: number, statusText: string, headers: Record<string, string>, body: Uint8Array, redirects: number, ms: number): HttpResponse {
	return {
		url: url.href,
		status,
		statusText,
		ok: status >= 200 && status < 300,
		headers,
		body,
		redirects,
		ms,
		text: () => decoder.decode(body),
		json: <T>() => {
			try {
				return JSON.parse(decoder.decode(body)) as T;
			} catch (err) {
				throw new HttpError('invalid-body', 'Response body is not valid JSON', {status, cause: err});
			}
		},
	};
}

const positive = (value: number | undefined, name: string, fallback: number, min = 1): number => {
	if (value === undefined) return fallback;
	if (!Number.isFinite(value) || value < min) throw invalid(`"${name}" must be a number of at least ${min}`);
	return Math.floor(value);
};

export function createHttpClient(options: HttpClientOptions): HttpClient {
	const {transport, baseUrl, log} = options;
	const allowPrivate = options.allowPrivate === true;
	const defaults = options.defaults ?? {};

	const request = async (req: HttpRequest): Promise<HttpResponse> => {
		let method: HttpMethod = req.method ?? 'GET';
		if (req.body !== undefined && req.json !== undefined) throw invalid('Give either "body" or "json", not both');
		const timeoutMs = positive(req.timeoutMs ?? defaults.timeoutMs, 'timeoutMs', DEFAULTS.timeoutMs);
		const maxBytes = positive(req.maxBytes ?? defaults.maxBytes, 'maxBytes', DEFAULTS.maxBytes, 0);
		const maxRedirects = positive(req.redirects ?? defaults.redirects, 'redirects', DEFAULTS.redirects, 0);
		const throwOnStatus = req.throwOnStatus ?? defaults.throwOnStatus ?? false;
		let headers = normaliseHeaders({'user-agent': DEFAULTS.userAgent}, defaults.headers, req.headers);
		let body: string | Uint8Array | undefined = req.body;
		if (req.json !== undefined) {
			body = JSON.stringify(req.json);
			if (body === undefined) throw invalid('"json" cannot be serialised');
			headers['content-type'] ??= 'application/json';
		}
		if (body !== undefined && (method === 'GET' || method === 'HEAD')) throw invalid(`${method} requests cannot have a body`);
		let url = buildUrl(req.url, baseUrl, req.query);

		const deadline = AbortSignal.timeout(timeoutMs);
		const signal = req.signal ? AbortSignal.any([req.signal, deadline]) : deadline;
		const started = Date.now();
		let redirects = 0;
		try {
			for (;;) {
				checkTarget(url, allowPrivate);
				const res = await transport.send({method, url, headers, ...(body !== undefined && {body}), signal, maxBytes});
				const location = res.headers.location;
				if (res.status >= 300 && res.status < 400 && location !== undefined && maxRedirects > 0) {
					if (redirects >= maxRedirects) throw new HttpError('too-many-redirects', `More than ${maxRedirects} redirects`);
					const next = buildUrl(location, url.href, undefined);
					if (next.origin !== url.origin) {
						headers = {...headers};
						for (const name of ORIGIN_BOUND) delete headers[name];
					}
					if (res.status === 303 || ((res.status === 301 || res.status === 302) && method === 'POST')) {
						if (method !== 'HEAD') method = 'GET';
						body = undefined;
						headers = {...headers};
						for (const name of BODY_HEADERS) delete headers[name];
					}
					url = next;
					redirects++;
					continue;
				}
				const response = makeResponse(url, res.status, res.statusText, res.headers, res.body, redirects, Date.now() - started);
				log?.debug('http request', {method, status: res.status, bytes: res.body.length, redirects, ms: response.ms});
				if (throwOnStatus && res.status >= 400) {
					throw new HttpError('status', `HTTP ${res.status}${res.statusText ? ` ${res.statusText}` : ''}`, {status: res.status, response});
				}
				return response;
			}
		} catch (err) {
			const failure =
				err instanceof HttpError
					? err
					: deadline.aborted
						? new HttpError('timeout', `Request timed out after ${timeoutMs} ms`, {cause: err})
						: signal.aborted
							? new HttpError('aborted', 'Request was aborted', {cause: err})
							: new HttpError('network', 'Request failed', {cause: err});
			log?.debug('http request failed', {method, code: failure.code, ms: Date.now() - started});
			throw failure;
		}
	};

	const run = async (req: HttpRequest, signal: AbortSignal | undefined): Promise<HttpResult> => {
		try {
			const merged = signal ? {...req, signal: req.signal ? AbortSignal.any([req.signal, signal]) : signal} : req;
			return {ok: true, response: await request(merged)};
		} catch (err) {
			return {ok: false, error: err instanceof HttpError ? err : new HttpError('network', 'Request failed', {cause: err})};
		}
	};

	const all = async (requests: readonly HttpRequest[], batch: BatchOptions = {}): Promise<HttpResult[]> => {
		const limit = positive(batch.concurrency, 'concurrency', 6);
		const results: HttpResult[] = new Array(requests.length);
		let next = 0;
		const worker = async () => {
			while (next < requests.length) {
				const index = next++;
				results[index] = await run(requests[index]!, batch.signal);
			}
		};
		await Promise.all(Array.from({length: Math.min(limit, requests.length)}, worker));
		return results;
	};

	const helper =
		(method: HttpMethod) =>
		(url: string | URL, opts: RequestOptions = {}) =>
			request({...opts, method, url});

	return {
		request,
		get: helper('GET'),
		head: helper('HEAD'),
		options: helper('OPTIONS'),
		delete: helper('DELETE'),
		post: helper('POST'),
		put: helper('PUT'),
		patch: helper('PATCH'),
		all,
		sequence: (requests, batch = {}) => all(requests, {...batch, concurrency: 1}),
		close: () => transport.close(),
	};
}

export const HTTP_METHODS = ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'] as const;
export type HttpMethod = (typeof HTTP_METHODS)[number];

export type QueryValue = string | number | boolean | undefined;

export type HttpRequest = {
	/** Default `GET`. */
	method?: HttpMethod;
	url: string | URL;
	headers?: Record<string, string>;
	/** Appended to the URL's search params; `undefined` values are skipped. */
	query?: Record<string, QueryValue | readonly QueryValue[]>;
	/** Raw body. Mutually exclusive with `json`. */
	body?: string | Uint8Array;
	/** Serialised with `JSON.stringify`; sets `content-type: application/json` unless given. */
	json?: unknown;
	/** Total time for the request, redirects included. */
	timeoutMs?: number;
	/** Largest response body accepted, in bytes. */
	maxBytes?: number;
	/** Redirects followed before failing with `too-many-redirects`; 0 returns the 3xx response as is. */
	redirects?: number;
	/** Throw `HttpError` with code `status` on a 4xx/5xx response. */
	throwOnStatus?: boolean;
	signal?: AbortSignal;
};

/** Per-request options of the method helpers (`get`, `post`, …). */
export type RequestOptions = Omit<HttpRequest, 'url' | 'method'>;

export type HttpResponse = {
	/** Final URL, after redirects. */
	url: string;
	status: number;
	statusText: string;
	/** True for 2xx. */
	ok: boolean;
	/** Lower-case names; repeated headers are joined with `, ` (`set-cookie` with `\n`). */
	headers: Record<string, string>;
	body: Uint8Array;
	redirects: number;
	ms: number;
	/** Body decoded as UTF-8. */
	text(): string;
	/** Body parsed as JSON; throws `HttpError` with code `invalid-body` when it is not JSON. */
	json<T = unknown>(): T;
};

export type HttpErrorCode =
	| 'invalid-request'
	| 'blocked'
	| 'timeout'
	| 'aborted'
	| 'too-large'
	| 'too-many-redirects'
	| 'network'
	| 'status'
	| 'invalid-body';

export class HttpError extends Error {
	readonly code: HttpErrorCode;
	readonly status?: number;
	readonly response?: HttpResponse;

	constructor(code: HttpErrorCode, message: string, extra: {status?: number; response?: HttpResponse; cause?: unknown} = {}) {
		super(message, extra.cause === undefined ? undefined : {cause: extra.cause});
		this.name = 'HttpError';
		this.code = code;
		if (extra.status !== undefined) this.status = extra.status;
		if (extra.response !== undefined) this.response = extra.response;
	}
}

export type HttpResult = {ok: true; response: HttpResponse} | {ok: false; error: HttpError};

/** One hop on the wire: no redirects, no retries. Everything library-specific lives behind this. */
export type TransportRequest = {
	method: HttpMethod;
	url: URL;
	headers: Record<string, string>;
	body?: string | Uint8Array;
	signal: AbortSignal;
	maxBytes: number;
};

export type TransportResponse = {
	status: number;
	statusText: string;
	headers: Record<string, string>;
	body: Uint8Array;
};

/**
 * A transport must refuse to connect to a blocked address (`HttpError` code `blocked`) unless it was
 * created to allow them, fail with `too-large` past `maxBytes`, reject when `signal` aborts, and map
 * every other failure of its library to `HttpError` code `network`.
 */
export type Transport = {
	send(req: TransportRequest): Promise<TransportResponse>;
	close(): Promise<void>;
};

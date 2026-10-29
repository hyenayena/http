export const HTTP_METHODS = ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'] as const;
export type HttpMethod = (typeof HTTP_METHODS)[number];

export type QueryValue = string | number | boolean | undefined;

export type HttpRequest = {
	method?: HttpMethod;
	url: string | URL;
	headers?: Record<string, string>;
	query?: Record<string, QueryValue | readonly QueryValue[]>;
	body?: string | Uint8Array;
	json?: unknown;
	timeoutMs?: number;
	maxBytes?: number;
	redirects?: number;
	throwOnStatus?: boolean;
	signal?: AbortSignal;
};

export type RequestOptions = Omit<HttpRequest, 'url' | 'method'>;

export type HttpResponse = {
	url: string;
	status: number;
	statusText: string;
	ok: boolean;
	headers: Record<string, string>;
	body: Uint8Array;
	redirects: number;
	ms: number;
	text(): string;
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

export type Transport = {
	send(req: TransportRequest): Promise<TransportResponse>;
	close(): Promise<void>;
};

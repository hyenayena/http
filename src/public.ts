// The http module's public entry: other modules import only this file (through one adapter file of
// their own, with http in their yena.json dependencies). Pure: no host values, no React or Ink.
import {createHttpClient as createClient, type HttpClient, type HttpClientOptions} from './client/client.js';
import {createUndiciTransport} from './client/undici.js';

export {HTTP_METHODS, HttpError} from './client/types.js';
export type {
	HttpErrorCode,
	HttpMethod,
	HttpRequest,
	HttpResponse,
	HttpResult,
	QueryValue,
	RequestOptions,
	Transport,
	TransportRequest,
	TransportResponse,
} from './client/types.js';
export type {BatchOptions, ClientDefaults, HttpClient} from './client/client.js';
export {DEFAULTS} from './client/client.js';
export {isBlockedAddress} from './client/address.js';

export type CreateHttpClientOptions = Omit<HttpClientOptions, 'transport'> & {
	/** Replaces the default transport (tests, another library). */
	transport?: HttpClientOptions['transport'];
};

/**
 * An HTTP client. Private, loopback and link-local addresses are refused unless `allowPrivate` is
 * set (for a module that talks to a local service on purpose). Call `close()` when done with it.
 */
export function createHttpClient(options: CreateHttpClientOptions = {}): HttpClient {
	const allowPrivate = options.allowPrivate === true;
	return createClient({...options, allowPrivate, transport: options.transport ?? createUndiciTransport({allowPrivate})});
}

export {htmlToMarkdown, isHtml} from './html/markdown.js';
export type {HtmlToMarkdownOptions, PageMarkdown} from './html/markdown.js';

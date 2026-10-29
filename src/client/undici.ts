import dns from 'node:dns';
import type {LookupFunction} from 'node:net';
import {Agent, request} from 'undici';
import {isBlockedAddress} from './address.js';
import {HttpError, type Transport, type TransportRequest, type TransportResponse} from './types.js';

export type UndiciTransportOptions = {
	allowPrivate?: boolean;
	lookup?: typeof dns.lookup;
};

const BLOCKED = Symbol('blocked');

const blockedError = (): Error => Object.assign(new Error('Blocked address'), {[BLOCKED]: true, code: 'EBLOCKED'});

const guardedLookup = (base: typeof dns.lookup): LookupFunction =>
	((hostname: string, options: dns.LookupOptions, callback: (...args: unknown[]) => void) => {
		base(hostname, {...options, all: true}, (err, addresses) => {
			if (err) return callback(err);
			const list = addresses as dns.LookupAddress[];
			if (list.length === 0 || list.some(a => isBlockedAddress(a.address))) return callback(blockedError());
			if (options.all) return callback(null, list);
			callback(null, list[0]!.address, list[0]!.family);
		});
	}) as LookupFunction;

const isBlocked = (err: unknown): boolean => {
	for (let e = err, depth = 0; e && typeof e === 'object' && depth < 8; e = (e as {cause?: unknown}).cause, depth++) {
		if ((e as {[BLOCKED]?: boolean})[BLOCKED]) return true;
	}
	return false;
};

const flatHeaders = (raw: Record<string, string | string[] | undefined>): Record<string, string> => {
	const out: Record<string, string> = {};
	for (const [name, value] of Object.entries(raw)) {
		if (value === undefined) continue;
		const key = name.toLowerCase();
		out[key] = Array.isArray(value) ? value.join(key === 'set-cookie' ? '\n' : ', ') : value;
	}
	return out;
};

const tooLarge = (max: number) => new HttpError('too-large', `Response body is larger than ${max} bytes`);

export function createUndiciTransport(options: UndiciTransportOptions = {}): Transport {
	const agent = new Agent(options.allowPrivate ? {} : {connect: {lookup: guardedLookup(options.lookup ?? dns.lookup)}});

	const send = async (req: TransportRequest): Promise<TransportResponse> => {
		let res;
		try {
			res = await request(req.url, {
				dispatcher: agent,
				method: req.method,
				headers: req.headers,
				body: req.body ?? null,
				signal: req.signal,
			});
		} catch (err) {
			if (req.signal.aborted) throw err;
			if (isBlocked(err)) throw new HttpError('blocked', `Refused to connect to a private address of ${req.url.hostname}`);
			throw new HttpError('network', `Request to ${req.url.host} failed`, {cause: err});
		}
		const headers = flatHeaders(res.headers);
		const declared = Number(headers['content-length']);
		if (Number.isFinite(declared) && declared > req.maxBytes) {
			res.body.destroy();
			throw tooLarge(req.maxBytes);
		}
		const chunks: Buffer[] = [];
		let size = 0;
		try {
			for await (const chunk of res.body) {
				size += (chunk as Buffer).length;
				if (size > req.maxBytes) {
					res.body.destroy();
					throw tooLarge(req.maxBytes);
				}
				chunks.push(chunk as Buffer);
			}
		} catch (err) {
			if (err instanceof HttpError || req.signal.aborted) throw err;
			throw new HttpError('network', `Reading the response from ${req.url.host} failed`, {cause: err});
		}
		return {status: res.statusCode, statusText: res.statusText ?? '', headers, body: new Uint8Array(Buffer.concat(chunks))};
	};

	return {send, close: () => agent.close()};
}

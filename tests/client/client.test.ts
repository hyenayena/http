import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createHttpClient} from '../../src/client/client.js';
import {HttpError} from '../../src/client/types.js';
import {bytes, fakeTransport} from '../helpers.js';

const rejectsWith = (promise: Promise<unknown>, code: string) =>
	assert.rejects(promise, (err: unknown) => err instanceof HttpError && err.code === code);

test('method helpers send their method with merged, lower-cased headers', async () => {
	const fake = fakeTransport({status: 201, statusText: 'Created', headers: {'x-id': '7'}, body: bytes('done')});
	const client = createHttpClient({transport: fake.transport, defaults: {headers: {'X-Team': 'yena'}}});
	for (const method of ['get', 'head', 'options', 'delete', 'post', 'put', 'patch'] as const) {
		await client[method]('https://example.com/x', {headers: {Accept: 'text/plain'}});
	}
	assert.deepEqual(
		fake.sent.map(r => r.method),
		['GET', 'HEAD', 'OPTIONS', 'DELETE', 'POST', 'PUT', 'PATCH'],
	);
	assert.deepEqual(fake.sent[0]!.headers, {'user-agent': 'yena-http', 'x-team': 'yena', accept: 'text/plain'});
	const res = await client.get('https://example.com/x');
	assert.equal(res.status, 201);
	assert.equal(res.ok, true);
	assert.equal(res.text(), 'done');
	assert.equal(res.headers['x-id'], '7');
});

test('json bodies, raw bodies, query and baseUrl', async () => {
	const fake = fakeTransport({body: bytes('{"ok":true}')});
	const client = createHttpClient({transport: fake.transport, baseUrl: 'https://api.example.com/v1/'});
	const res = await client.post('items', {json: {a: 1}, query: {tag: ['x', 'y'], skip: undefined, n: 2}});
	assert.equal(fake.sent[0]!.url.href, 'https://api.example.com/v1/items?tag=x&tag=y&n=2');
	assert.equal(fake.sent[0]!.body, '{"a":1}');
	assert.equal(fake.sent[0]!.headers['content-type'], 'application/json');
	assert.deepEqual(res.json(), {ok: true});
	await client.put('items/1', {body: 'raw', headers: {'Content-Type': 'text/plain'}});
	assert.equal(fake.sent[1]!.body, 'raw');
	assert.equal(fake.sent[1]!.headers['content-type'], 'text/plain');
});

test('invalid requests are refused before anything is sent', async () => {
	const fake = fakeTransport({});
	const client = createHttpClient({transport: fake.transport});
	await rejectsWith(client.get('ftp://example.com'), 'invalid-request');
	await rejectsWith(client.get('not a url'), 'invalid-request');
	await rejectsWith(client.get('https://user:pw@example.com'), 'invalid-request');
	await rejectsWith(client.get('https://example.com', {body: 'x'}), 'invalid-request');
	await rejectsWith(client.post('https://example.com', {body: 'x', json: {}}), 'invalid-request');
	await rejectsWith(client.get('https://example.com', {headers: {'bad name': 'x'}}), 'invalid-request');
	await rejectsWith(client.get('https://example.com', {headers: {'x-a': 'one\r\nx-b: two'}}), 'invalid-request');
	await rejectsWith(client.get('https://example.com', {timeoutMs: -1}), 'invalid-request');
	assert.equal(fake.sent.length, 0);
});

test('IP literals of private addresses are blocked unless allowed', async () => {
	const fake = fakeTransport({});
	await rejectsWith(createHttpClient({transport: fake.transport}).get('http://127.0.0.1:8080/'), 'blocked');
	await rejectsWith(createHttpClient({transport: fake.transport}).get('http://[::1]/'), 'blocked');
	await rejectsWith(createHttpClient({transport: fake.transport}).get('http://169.254.169.254/latest/meta-data'), 'blocked');
	assert.equal(fake.sent.length, 0);
	await createHttpClient({transport: fake.transport, allowPrivate: true}).get('http://127.0.0.1:8080/');
	assert.equal(fake.sent.length, 1);
});

test('a redirect to a private IP is blocked on that hop', async () => {
	const fake = fakeTransport({status: 302, headers: {location: 'http://10.0.0.5/admin'}});
	await rejectsWith(createHttpClient({transport: fake.transport}).get('https://example.com/'), 'blocked');
	assert.equal(fake.sent.length, 1);
});

test('redirects: 303 becomes GET, 307 keeps method and body, cross-origin drops credentials', async () => {
	const fake = fakeTransport(
		{status: 307, headers: {location: '/again'}},
		{status: 303, headers: {location: 'https://other.example.org/done'}},
		{status: 200, body: bytes('end')},
	);
	const client = createHttpClient({transport: fake.transport});
	const res = await client.post('https://example.com/start', {
		body: 'payload',
		headers: {authorization: 'Bearer t', cookie: 'a=b', 'content-type': 'text/plain', 'x-keep': '1'},
	});
	assert.deepEqual(
		fake.sent.map(r => [r.method, r.url.href, r.body]),
		[
			['POST', 'https://example.com/start', 'payload'],
			['POST', 'https://example.com/again', 'payload'],
			['GET', 'https://other.example.org/done', undefined],
		],
	);
	assert.equal(fake.sent[1]!.headers.authorization, 'Bearer t');
	assert.equal(fake.sent[2]!.headers.authorization, undefined);
	assert.equal(fake.sent[2]!.headers.cookie, undefined);
	assert.equal(fake.sent[2]!.headers['content-type'], undefined);
	assert.equal(fake.sent[2]!.headers['x-keep'], '1');
	assert.equal(res.redirects, 2);
	assert.equal(res.url, 'https://other.example.org/done');
});

test('too many redirects fail; redirects: 0 returns the 3xx response', async () => {
	const fake = fakeTransport({status: 301, headers: {location: '/loop'}});
	const client = createHttpClient({transport: fake.transport});
	await rejectsWith(client.get('https://example.com/', {redirects: 2}), 'too-many-redirects');
	assert.equal(fake.sent.length, 3);
	const res = await client.get('https://example.com/', {redirects: 0});
	assert.equal(res.status, 301);
});

test('throwOnStatus turns 4xx/5xx into HttpError with the response', async () => {
	const fake = fakeTransport({status: 404, statusText: 'Not Found', body: bytes('nope')});
	const client = createHttpClient({transport: fake.transport});
	const plain = await client.get('https://example.com/');
	assert.equal(plain.ok, false);
	await assert.rejects(client.get('https://example.com/', {throwOnStatus: true}), (err: unknown) => {
		assert.ok(err instanceof HttpError);
		assert.equal(err.code, 'status');
		assert.equal(err.status, 404);
		assert.equal(err.response?.text(), 'nope');
		return true;
	});
});

test('json() on a non-JSON body throws invalid-body', async () => {
	const fake = fakeTransport({body: bytes('<html>')});
	const res = await createHttpClient({transport: fake.transport}).get('https://example.com/');
	assert.throws(() => res.json(), (err: unknown) => err instanceof HttpError && err.code === 'invalid-body');
});

const hang = (req: {signal: AbortSignal}) =>
	new Promise<never>((_, reject) => req.signal.addEventListener('abort', () => reject(req.signal.reason), {once: true}));

test('timeout and abort are told apart', async () => {
	const fake = fakeTransport(hang);
	const client = createHttpClient({transport: fake.transport});
	await rejectsWith(client.get('https://example.com/', {timeoutMs: 20}), 'timeout');
	const controller = new AbortController();
	const pending = client.get('https://example.com/', {signal: controller.signal});
	controller.abort();
	await rejectsWith(pending, 'aborted');
});

test('all() keeps order, bounds concurrency and never rejects', async () => {
	let active = 0;
	let peak = 0;
	const fake = fakeTransport(async req => {
		active++;
		peak = Math.max(peak, active);
		await new Promise(r => setTimeout(r, 5));
		active--;
		if (req.url.pathname === '/bad') throw new Error('boom');
		return {body: bytes(req.url.pathname)};
	});
	const client = createHttpClient({transport: fake.transport});
	const paths = ['/1', '/2', '/bad', '/4', '/5', '/6', '/7'];
	const results = await client.all(paths.map(p => ({url: `https://example.com${p}`})), {concurrency: 3});
	assert.equal(peak, 3);
	assert.deepEqual(
		results.map(r => (r.ok ? r.response.text() : r.error.code)),
		['/1', '/2', 'network', '/4', '/5', '/6', '/7'],
	);
});

test('sequence() runs one request at a time in order', async () => {
	const order: string[] = [];
	let active = 0;
	let peak = 0;
	const fake = fakeTransport(async req => {
		active++;
		peak = Math.max(peak, active);
		order.push(req.url.pathname);
		await new Promise(r => setTimeout(r, 2));
		active--;
		return {};
	});
	const client = createHttpClient({transport: fake.transport});
	const results = await client.sequence(['/a', '/b', '/c'].map(p => ({url: `https://example.com${p}`})));
	assert.equal(peak, 1);
	assert.deepEqual(order, ['/a', '/b', '/c']);
	assert.ok(results.every(r => r.ok));
});

test('a batch signal cancels unfinished requests', async () => {
	const fake = fakeTransport(hang);
	const client = createHttpClient({transport: fake.transport});
	const controller = new AbortController();
	const pending = client.all([{url: 'https://example.com/1'}, {url: 'https://example.com/2'}], {signal: controller.signal});
	setTimeout(() => controller.abort(), 5);
	const results = await pending;
	assert.deepEqual(results.map(r => (r.ok ? 'ok' : r.error.code)), ['aborted', 'aborted']);
});

test('close() closes the transport', async () => {
	const fake = fakeTransport({});
	await createHttpClient({transport: fake.transport}).close();
	assert.equal(fake.closed(), true);
});

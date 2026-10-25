import assert from 'node:assert/strict';
import type dns from 'node:dns';
import {after, before, test} from 'node:test';
import {createHttpClient} from '../../src/client/client.js';
import {HttpError} from '../../src/client/types.js';
import {createUndiciTransport} from '../../src/client/undici.js';
import {startServer} from '../helpers.js';

let server: Awaited<ReturnType<typeof startServer>>;

before(async () => {
	server = await startServer((req, res, body) => {
		if (req.url === '/big') {
			res.writeHead(200, {'content-type': 'text/plain'});
			res.end('x'.repeat(5000));
			return;
		}
		if (req.url === '/stream') {
			res.writeHead(200, {'content-type': 'text/plain'});
			for (let i = 0; i < 10; i++) res.write('y'.repeat(1000));
			res.end();
			return;
		}
		if (req.url === '/slow') {
			setTimeout(() => res.end('late'), 2000);
			return;
		}
		if (req.url === '/redirect') {
			res.writeHead(302, {location: '/echo'});
			res.end();
			return;
		}
		res.writeHead(200, {'content-type': 'application/json', 'set-cookie': ['a=1', 'b=2']});
		res.end(JSON.stringify({method: req.method, body, header: req.headers['x-test'] ?? null}));
	});
});

after(async () => {
	await server.close();
});

const local = () => createHttpClient({transport: createUndiciTransport({allowPrivate: true}), allowPrivate: true});

test('every method reaches the server with headers and body', async () => {
	const client = local();
	try {
		const got = await client.get(`${server.url}/echo`, {headers: {'x-test': 'hi'}});
		assert.deepEqual(got.json(), {method: 'GET', body: '', header: 'hi'});
		assert.equal(got.headers['set-cookie'], 'a=1\nb=2');
		for (const method of ['POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'] as const) {
			const res = await client.request({method, url: `${server.url}/echo`, json: {n: 1}});
			assert.deepEqual(res.json(), {method, body: '{"n":1}', header: null});
		}
		const head = await client.head(`${server.url}/echo`);
		assert.equal(head.status, 200);
		assert.equal(head.body.length, 0);
	} finally {
		await client.close();
	}
});

test('follows a real redirect', async () => {
	const client = local();
	try {
		const res = await client.get(`${server.url}/redirect`);
		assert.equal(res.redirects, 1);
		assert.equal(new URL(res.url).pathname, '/echo');
	} finally {
		await client.close();
	}
});

test('maxBytes stops a declared and a streamed body', async () => {
	const client = local();
	try {
		for (const path of ['/big', '/stream']) {
			await assert.rejects(
				client.get(`${server.url}${path}`, {maxBytes: 1000}),
				(err: unknown) => err instanceof HttpError && err.code === 'too-large',
				path,
			);
		}
	} finally {
		await client.close();
	}
});

test('a timeout cancels the request', async () => {
	const client = local();
	try {
		await assert.rejects(client.get(`${server.url}/slow`, {timeoutMs: 100}), (err: unknown) => err instanceof HttpError && err.code === 'timeout');
	} finally {
		await client.close();
	}
});

test('by default a name that resolves to a private address is refused at connect time', async () => {
	const lookup = ((_host: string, _opts: unknown, cb: (err: null, addrs: dns.LookupAddress[]) => void) =>
		cb(null, [{address: '127.0.0.1', family: 4}])) as unknown as typeof dns.lookup;
	const client = createHttpClient({transport: createUndiciTransport({lookup})});
	try {
		await assert.rejects(
			client.get(`http://public.example.test:${server.port}/echo`),
			(err: unknown) => err instanceof HttpError && err.code === 'blocked',
		);
		assert.equal(server.seen.filter(s => s.headers.host?.startsWith('public.example.test')).length, 0);
	} finally {
		await client.close();
	}
});

test('a connection failure is a network error', async () => {
	const client = local();
	try {
		await assert.rejects(client.get('http://127.0.0.1:1/'), (err: unknown) => err instanceof HttpError && err.code === 'network');
	} finally {
		await client.close();
	}
});

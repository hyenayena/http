import assert from 'node:assert/strict';
import {test} from 'node:test';
import plugin from '../src/index.js';
import {createHttpClient, HttpError} from '../src/public.js';
import {fakeTransport} from './helpers.js';

test('the default client blocks private addresses', async () => {
	const client = createHttpClient();
	try {
		await assert.rejects(client.get('http://127.0.0.1/'), (err: unknown) => err instanceof HttpError && err.code === 'blocked');
		await assert.rejects(client.get('http://localhost:1/'), (err: unknown) => err instanceof HttpError && err.code === 'blocked');
	} finally {
		await client.close();
	}
});

test('a custom transport replaces the library', async () => {
	const fake = fakeTransport({status: 204});
	const res = await createHttpClient({transport: fake.transport}).delete('https://example.com/a');
	assert.equal(res.status, 204);
	assert.equal(fake.sent[0]!.method, 'DELETE');
});

test('the plugin registers the http command, with or without a logger', async () => {
	const host = {dataDir: '/nonexistent', events: {emit() {}, on: () => () => {}}, log: undefined as never};
	const commands = await plugin(host);
	assert.deepEqual(commands.map(c => c.name), ['http']);
});

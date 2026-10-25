import assert from 'node:assert/strict';
import {mkdtemp, rm, writeFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {test} from 'node:test';
import type {CommandContext} from '../../../src/api.js';
import {createHttpClient} from '../src/client/client.js';
import {createCommand, MAX_BODY_FILE, MAX_SHOWN} from '../src/commands.js';
import {bytes, fakeTransport, type FakeReply} from './helpers.js';

const setup = (reply: FakeReply = {}, cwd?: string) => {
	const fake = fakeTransport(reply);
	const client = createHttpClient({transport: fake.transport});
	const cmd = createCommand({client: () => client, ...(cwd && {cwd})});
	const lines: string[] = [];
	const ctx: CommandContext = {print: t => lines.push(t), clear() {}, exit() {}};
	return {cmd, fake, lines, run: async (...args: string[]) => cmd.run(args, ctx)};
};

test('help lists every method and is the only subcommand safe for the assistant', async () => {
	const {cmd, lines, run} = setup();
	await run();
	assert.equal(lines.length, 8);
	assert.equal(cmd.agent, 'confirm');
	assert.deepEqual(
		cmd.subcommands!.filter(s => s.agent === 'safe').map(s => s.name),
		['help'],
	);
});

test('get prints the status line and the text body', async () => {
	const {fake, lines, run} = setup({status: 200, statusText: 'OK', headers: {'content-type': 'text/plain'}, body: bytes('hello')});
	await run('get', 'https://x.test/', '-H', 'X-A:1');
	assert.equal(fake.sent[0]!.headers['x-a'], '1');
	assert.match(lines[0]!, /^HTTP 200 OK · 5 B · \d+ ms$/);
	assert.deepEqual(lines.slice(1), ['', 'hello']);
});

test('-i shows headers; binary bodies are not printed; escapes are stripped', async () => {
	const esc = String.fromCharCode(27);
	const bin = setup({headers: {'content-type': 'image/png'}, body: new Uint8Array([1, 2, 0, 3])});
	await bin.run('get', 'https://x.test/', '-i');
	assert.ok(bin.lines.includes('content-type: image/png'));
	assert.equal(bin.lines.at(-1), '(binary body, 4 B, not shown)');
	const text = setup({headers: {'content-type': 'text/plain'}, body: bytes(`a${esc}[31mred`)});
	await text.run('get', 'https://x.test/');
	assert.equal(text.lines.at(-1)!.includes(esc), false);
});

test('post --json --data sends JSON with the right headers', async () => {
	const {fake, run} = setup({});
	await run('post', 'https://x.test/items', '--json', '--data', '{"a":', '1}');
	assert.equal(fake.sent[0]!.method, 'POST');
	assert.equal(fake.sent[0]!.body, '{"a": 1}');
	assert.equal(fake.sent[0]!.headers['content-type'], 'application/json');
	assert.equal(fake.sent[0]!.headers.accept, 'application/json');
});

test('--file sends the file; a missing or large file is refused', async () => {
	const dir = await mkdtemp(path.join(os.tmpdir(), 'http-cmd-'));
	try {
		await writeFile(path.join(dir, 'body.txt'), 'from file');
		await writeFile(path.join(dir, 'big.txt'), 'x'.repeat(MAX_BODY_FILE + 1));
		const {fake, run} = setup({}, dir);
		await run('put', 'https://x.test/', '--file', 'body.txt');
		assert.equal(new TextDecoder().decode(fake.sent[0]!.body as Uint8Array), 'from file');
		await assert.rejects(run('put', 'https://x.test/', '--file', 'nope.txt'), /No such file/);
		await assert.rejects(run('put', 'https://x.test/', '--file', 'big.txt'), /larger than/);
	} finally {
		await rm(dir, {recursive: true, force: true});
	}
});

test('errors become plain Errors with a readable message', async () => {
	const {run} = setup();
	await assert.rejects(run('get', 'http://127.0.0.1/'), /private address/);
	await assert.rejects(run('get', 'https://x.test/', '--data', 'x'), /cannot have a body/);
	await assert.rejects(run('post', 'https://x.test/', '--json', '--data', '{bad'), /not valid JSON/);
	await assert.rejects(run('fetch', 'https://x.test/'), /Unknown subcommand/);
});

test('an HTML response is shown as Markdown with its title; --raw shows the source', async () => {
	const html = '<!doctype html><html><head><title>Page</title><script>var big = 1;</script></head><body><h1>Hi</h1><p><a href="/next">next</a></p></body></html>';
	const reply = {headers: {'content-type': 'text/html; charset=utf-8'}, body: bytes(html)};
	const md = setup(reply);
	await md.run('get', 'https://x.test/dir/');
	assert.match(md.lines[2]!, /^\(HTML converted to Markdown, \d+ B -> \d+ B; --raw shows the source\)$/);
	assert.equal(md.lines[3], 'Title: Page');
	assert.equal(md.lines.at(-1), '# Hi\n\n[next](https://x.test/next)');
	const raw = setup(reply);
	await raw.run('get', 'https://x.test/', '--raw');
	assert.equal(raw.lines.at(-1), html);
});

test('an untyped body is converted only when it looks like an HTML document', async () => {
	const doc = setup({body: bytes('<!DOCTYPE html><p>x</p>')});
	await doc.run('get', 'https://x.test/');
	assert.equal(doc.lines.at(-1), 'x');
	const frag = setup({body: bytes('<p>x</p>')});
	await frag.run('get', 'https://x.test/');
	assert.equal(frag.lines.at(-1), '<p>x</p>');
});

test('a long text is shown in parts that --from continues, ending at line breaks', async () => {
	const lines = Array.from({length: 3000}, (_, i) => `line ${String(i).padStart(4, '0')} ${'.'.repeat(10)}`);
	const reply = {headers: {'content-type': 'text/plain'}, body: bytes(lines.join('\n'))};
	const first = setup(reply);
	await first.run('get', 'https://x.test/');
	const footer = first.lines.at(-1)!;
	const next = Number(/--from (\d+)$/.exec(footer)![1]);
	assert.ok(first.lines.at(-2)!.length <= MAX_SHOWN);
	assert.ok(first.lines.at(-2)!.endsWith('.'));
	const second = setup(reply);
	await second.run('get', 'https://x.test/', '--from', String(next));
	assert.match(second.lines[2]!, new RegExp(`^\\(characters ${next}-\\d+ of \\d+\\)$`));
	assert.match(second.lines[4]!, /^line \d{4} /);
	const past = setup(reply);
	await past.run('get', 'https://x.test/', '--from', '999999');
	assert.match(past.lines.at(-1)!, /^\(nothing from character 999999: the text has \d+\)$/);
	await assert.rejects(past.run('get', 'https://x.test/', '--from', '-1'), /character offset/);
});

import assert from 'node:assert/strict';
import {test} from 'node:test';
import {isMethod, parseCall} from '../src/args.js';

test('parses headers, flags, timeout and the rest of the line as data', () => {
	const call = parseCall('POST', ['https://x.test/a', '-H', 'X-A:1', '--header', 'Accept: text/plain', '--json', '-i', '--raw', '--timeout', '2.5', '--data', '{"a":', '1}']);
	assert.deepEqual(call, {
		method: 'POST',
		url: 'https://x.test/a',
		headers: {'X-A': '1', Accept: 'text/plain'},
		json: true,
		include: true,
		raw: true,
		timeoutMs: 2500,
		data: '{"a": 1}',
	});
});

test('--file is kept as a path', () => {
	assert.equal(parseCall('PUT', ['https://x.test', '--file', 'body.json']).file, 'body.json');
});

test('bad input is refused', () => {
	assert.throws(() => parseCall('GET', []), /Missing URL/);
	assert.throws(() => parseCall('GET', ['a', 'b']), /one URL/);
	assert.throws(() => parseCall('GET', ['a', '-H', 'novalue']), /name:value/);
	assert.throws(() => parseCall('GET', ['a', '-H']), /needs a value/);
	assert.throws(() => parseCall('GET', ['a', '--timeout', '0']), /seconds/);
	assert.throws(() => parseCall('GET', ['a', '--what']), /Unknown option/);
	assert.throws(() => parseCall('POST', ['a', '--file', 'f', '--data', 'x']), /either/);
});

test('isMethod accepts any case', () => {
	assert.equal(isMethod('patch'), true);
	assert.equal(isMethod('PATCH'), true);
	assert.equal(isMethod('fetch'), false);
});

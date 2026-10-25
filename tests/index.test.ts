import assert from 'node:assert/strict';
import {test} from 'node:test';
import type {CommandContext} from '../../../src/api.js';
import plugin from '../src/index.js';

const host = () => ({dataDir: '/nonexistent', events: {emit() {}, on: () => () => {}}, log: undefined as never});

const ctx = (lines: string[]): CommandContext => ({print: t => lines.push(t), clear() {}, exit() {}});

test('registers the http command', async () => {
	const commands = await plugin(host());
	assert.deepEqual(commands.map(c => c.name), ['http']);
});

test('help lists the subcommands', async () => {
	const [cmd] = await plugin(host());
	const lines: string[] = [];
	await cmd!.run([], ctx(lines));
	assert.deepEqual(lines, ['http help  Show this help']);
});

test('an unknown subcommand throws', async () => {
	const [cmd] = await plugin(host());
	await assert.rejects(async () => cmd!.run(['get'], ctx([])), /Unknown subcommand "get"/);
});

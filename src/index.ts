import type {ModulePlugin} from '../../../src/api.js';
import type {HttpClient} from './client/client.js';
import {createCommand} from './commands.js';
import {createHttpClient} from './public.js';

const plugin: ModulePlugin = host => {
	let client: HttpClient | undefined;
	const log = host.log?.child('http');
	return [createCommand({client: () => (client ??= createHttpClient(log ? {log} : {}))})];
};

export default plugin;

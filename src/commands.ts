import type {Command, Subcommand} from '../../../src/api.js';

const subcommands: Subcommand[] = [{name: 'help', usage: 'http help', description: 'Show this help', agent: 'safe'}];

export function createCommand(): Command {
	return {
		name: 'http',
		description: 'Safe internet access for the assistant (not implemented yet)',
		usage: 'http help',
		subcommands,
		agent: 'safe',
		run: async ([sub], ctx) => {
			if (sub !== undefined && sub !== 'help') throw new Error(`Unknown subcommand "${sub}". Run "http help".`);
			for (const s of subcommands) ctx.print(`${s.usage}  ${s.description}`);
		},
	};
}

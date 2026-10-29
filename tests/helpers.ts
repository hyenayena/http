import http from 'node:http';
import type {AddressInfo} from 'node:net';
import type {TransportRequest, TransportResponse, Transport} from '../src/client/types.js';

export type Seen = {method: string; url: string; headers: http.IncomingHttpHeaders; body: string};

export async function startServer(handler: (req: http.IncomingMessage, res: http.ServerResponse, body: string) => void) {
	const seen: Seen[] = [];
	const server = http.createServer((req, res) => {
		const chunks: Buffer[] = [];
		req.on('data', c => chunks.push(c));
		req.on('end', () => {
			const body = Buffer.concat(chunks).toString('utf8');
			seen.push({method: req.method ?? '', url: req.url ?? '', headers: req.headers, body});
			handler(req, res, body);
		});
	});
	await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
	const {port} = server.address() as AddressInfo;
	return {
		url: `http://127.0.0.1:${port}`,
		port,
		seen,
		close: () => new Promise<void>(resolve => {
			server.closeAllConnections();
			server.close(() => resolve());
		}),
	};
}

export type FakeReply = Partial<TransportResponse> | ((req: TransportRequest) => Partial<TransportResponse> | Promise<Partial<TransportResponse>>);

export function fakeTransport(...replies: FakeReply[]) {
	const sent: TransportRequest[] = [];
	let closed = false;
	const transport: Transport = {
		send: async req => {
			sent.push(req);
			const reply = replies[Math.min(sent.length - 1, replies.length - 1)] ?? {};
			const r = typeof reply === 'function' ? await reply(req) : reply;
			return {status: 200, statusText: 'OK', headers: {}, body: new Uint8Array(), ...r};
		},
		close: async () => {
			closed = true;
		},
	};
	return {transport, sent, closed: () => closed};
}

export const bytes = (text: string) => new TextEncoder().encode(text);

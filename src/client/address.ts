import {BlockList, isIP} from 'node:net';

// Loopback, private, link-local (cloud metadata), CGNAT, multicast, reserved, special IPv6 ranges and
// NAT64. No ::ffff:0:0/96 rule: BlockList already matches IPv4-mapped IPv6 against the IPv4 rules, and
// that rule would block every IPv4 address.
const V4 = [
	['0.0.0.0', 8],
	['10.0.0.0', 8],
	['100.64.0.0', 10],
	['127.0.0.0', 8],
	['169.254.0.0', 16],
	['172.16.0.0', 12],
	['192.0.0.0', 24],
	['192.0.2.0', 24],
	['192.88.99.0', 24],
	['192.168.0.0', 16],
	['198.18.0.0', 15],
	['198.51.100.0', 24],
	['203.0.113.0', 24],
	['224.0.0.0', 4],
	['240.0.0.0', 4],
] as const;
const V6 = [
	['::', 128],
	['::1', 128],
	['64:ff9b::', 96],
	['64:ff9b:1::', 48],
	['100::', 64],
	['2001:db8::', 32],
	['2002::', 16],
	['fc00::', 7],
	['fe80::', 10],
	['fec0::', 10],
	['ff00::', 8],
] as const;

const blocked = new BlockList();
for (const [net, prefix] of V4) blocked.addSubnet(net, prefix, 'ipv4');
for (const [net, prefix] of V6) blocked.addSubnet(net, prefix, 'ipv6');

/** True for an address the client must not reach unless private addresses are allowed. */
export function isBlockedAddress(address: string): boolean {
	const family = isIP(address);
	if (family === 0) return false;
	return blocked.check(address, family === 4 ? 'ipv4' : 'ipv6');
}

/** The IP of a URL host given as a literal (`[::1]` without brackets), else undefined. */
export function ipLiteral(hostname: string): string | undefined {
	const bare = hostname.startsWith('[') && hostname.endsWith(']') ? hostname.slice(1, -1) : hostname;
	return isIP(bare) === 0 ? undefined : bare;
}

import assert from 'node:assert/strict';
import {test} from 'node:test';
import {ipLiteral, isBlockedAddress} from '../../src/client/address.js';

test('private, loopback, link-local and special addresses are blocked', () => {
	for (const ip of [
		'127.0.0.1',
		'10.1.2.3',
		'172.16.0.1',
		'172.31.255.255',
		'192.168.1.1',
		'169.254.169.254',
		'100.64.0.1',
		'0.0.0.0',
		'224.0.0.1',
		'255.255.255.255',
		'::1',
		'::',
		'fe80::1',
		'fd00::1',
		'::ffff:127.0.0.1',
		'::ffff:7f00:1',
		'64:ff9b::7f00:1',
	]) {
		assert.equal(isBlockedAddress(ip), true, ip);
	}
});

test('public addresses and non-IP text pass', () => {
	for (const ip of ['1.1.1.1', '8.8.8.8', '172.32.0.1', '2606:4700:4700::1111']) assert.equal(isBlockedAddress(ip), false, ip);
	assert.equal(isBlockedAddress('example.com'), false);
});

test('ipLiteral strips IPv6 brackets and ignores names', () => {
	assert.equal(ipLiteral('[::1]'), '::1');
	assert.equal(ipLiteral('10.0.0.1'), '10.0.0.1');
	assert.equal(ipLiteral('example.com'), undefined);
});

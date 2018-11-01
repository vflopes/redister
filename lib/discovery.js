'use strict';
const EventEmitter = require('events');
const request = require('request-promise-native');
const dns = require('dns');
const util = require('util');

const Healthcheck = require('./healthcheck.js');
const RedisNode = require('./redis-node.js');

const dnsResolve4 = util.promisify(dns.resolve4);
const dnsResolve6 = util.promisify(dns.resolve6);

class Discovery extends EventEmitter {

	constructor (hostname, port = 80) {
		
		super();
		
		this._hostname = hostname;
		this._port = port;
		this._interval = null;
		this._locked = false;
		this._peers = new Map();

	}

	get peers () {
		return this._peers;
	}

	removePeer (hostname) {

		if (!this._peers.has(hostname))
			return this;

		const peer = this._peers.get(hostname);
		this._peers.delete(hostname);
		peer.healthcheck.stop();
		peer.redis.disconnect();
		this.emit('removed', hostname);
		return this;

	}

	stop () {

		if (this._interval) {
			clearInterval(this._interval);
			this._interval = null;
			this.emit('stopped');
		}

		return this;

	}

	async _discoveryPeer () {

		const peerInformation = await request({uri:`http://${this._hostname}:${this._port}/me`,json:true});
		const ipv4 = await dnsResolve4(peerInformation.data.hostname);
		const ipv6 = await dnsResolve6(peerInformation.data.hostname);

		if (this._peers.has(peerInformation.data.hostname)) {
			const peer = Object.assign(
				peerInformation.data,
				{ipv6,ipv4,http_port:this._port}
			);
			peer.healthcheck = new Healthcheck(peer);
			peer.redis = new RedisNode(peer);
			this._peers.set(peerInformation.data.hostname, peer);
			this.emit('added', peerInformation.data.hostname);
			return void 0;
		}

		const peer = this._peers.get(peerInformation.data.hostname);
		peer.ipv4 = ipv4;
		peer.ipv6 = ipv6;
		this.emit('updated', peerInformation.data.hostname);
		return void 0;

	}

	run (discoveryInterval = 100) {

		this.stop();
		this._interval = setInterval(async () => {

			if (this._locked) {
				this.emit('aborted');
				return void 0;
			}

			this._locked = true;
			this.emit('locked');

			try {
				await this._discoveryPeer();
			} catch (error) {
				this.emit('error', error);
			} finally {
				this._locked = false;
				this.emit('unlocked');
			}

		}, discoveryInterval);

		this.emit('running');

		return this;

	}

}

module.exports = Discovery;
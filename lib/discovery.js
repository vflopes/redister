'use strict';
const EventEmitter = require('events');
const request = require('request-promise-native');
const dns = require('dns');
const util = require('util');

const sleep = require('./sleep.js');

const Healthcheck = require('./healthcheck.js');
const RedisNode = require('./redis-node.js');

const dnsResolve4 = util.promisify(dns.resolve4);
const dnsResolve6 = util.promisify(dns.resolve6);

class Discovery extends EventEmitter {

	constructor (hostnames, port = 80) {
		
		super();
		
		this._hostnames = hostnames;
		this._port = port;
		this._interval = null;
		this._locked = false;
		this._peers = new Map();

		process.on('SIGTERM', () => this.stop());

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
		peer.redis.node.disconnect(true).catch((error) => this.emit('error', error));
		peer.redis.standalone.disconnect(true).catch((error) => this.emit('error', error));
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

	async _discoveryPeersOfPeer (peers, discoveryFamily) {

		if (peers.length === 0)
			return void 0;

		await Promise.all(peers.map((peerHostname) => this._discoveryPeer(peerHostname, discoveryFamily, false)))

	}

	async _discoveryPeer (peerHostname, discoveryFamily, discoveryPeersOfPeers = true) {

		const peerInformation = await request({uri:`http://${peerHostname}:${this._port}/me`,json:true});
		const peerData = peerInformation.data;

		if (peerData.cluster_namespace !== process.env.CLUSTER_NAMESPACE)
			return void 0;

		const ipv4 = discoveryFamily === 4 ? await dnsResolve4(peerData.hostname) : [];
		const ipv6 = discoveryFamily === 6 ? await dnsResolve6(peerData.hostname) : [];

		if (!this._peers.has(peerData.hostname)) {
			const peer = Object.assign(
				peerData,
				{ipv6,ipv4,http_port:this._port}
			);
			peer.healthcheck = new Healthcheck(peer);
			peer.redis = {
				node:new RedisNode(peer, 'node'),
				standalone:new RedisNode(peer, 'standalone')
			};
			peer.remove = () => this.removePeer(peerHostname);
			this._peers.set(peerData.hostname, peer);
			this.emit('added', peerData.hostname);

			if (discoveryPeersOfPeers)
				await this._discoveryPeersOfPeer(peerData.peers, discoveryFamily);

			return void 0;
		}

		const peer = this._peers.get(peerData.hostname);
		peer.ipv4 = ipv4;
		peer.ipv6 = ipv6;
		this.emit('updated', peerData.hostname);

		if (discoveryPeersOfPeers)
			await this._discoveryPeersOfPeer(peerData.peers, discoveryFamily);

		return void 0;

	}

	run (discoveryInterval = 100, discoveryFamily = 4) {

		this.stop();
		this._interval = setInterval(async () => {

			if (this._locked) {
				this.emit('aborted');
				return void 0;
			}

			this._locked = true;
			this.emit('locked');

			try {
				
				sleep(Math.floor(Math.random()*parseInt(process.env.NODE_DISCOVERY_RANDOM_DELAY)));

				for (const hostname of this._hostnames)
					await this._discoveryPeer(hostname, discoveryFamily);

			} catch (error) {
				this.emit('error.discovery', error);
			} finally {
				this._locked = false;
				this.emit('unlocked');
			}

		}, discoveryInterval);

		this.emit('running');

		return this;

	}

}

Discovery.discovery = new Discovery(
	[
		process.env.NODE_DISCOVERY_HOSTNAME
	],
	parseInt(process.env.HTTP_SERVER_PORT)
);

module.exports = Discovery;
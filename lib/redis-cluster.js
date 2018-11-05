'use strict';
const Quorum = require('./quorum.js');

class RedisCluster {

	constructor () {

		this._witnessServer = null;
		this._ensuring = false;
		this._quorum = new Quorum(this);
		this._nodes = new Map();

	}

	get quorum () {
		return this._quorum;
	}

	get witnessServer () {
		return this._witnessServer;
	}

	async connectWitnessServer (peer) {

		this._witnessServer = peer;
		this._witnessServer.redis
			.on('end', () => this._witnessServer = null)
			.on('error', () => this._witnessServer = null);
		await this._witnessServer.redis.connect();

	}

	async disconnectWitnessServer () {

		if (this._witnessServer === null)
			return void 0;

		await this._witnessServer.disconnect();

	}

	async addNodeFromPeer (peer) {

		if (this._nodes.has(peer.hostname))
			return void 0;

		this._nodes.set(peer.hostname, peer);
		peer.redis
			.on('end', () => this._nodes.delete(peer.hostname))
			.on('error', () => this._nodes.delete(peer.hostname));
		await peer.redis.connect();

	}

	async _ensureLeader () {

		if (this._nodes.size < 3) {
			this._ensuring = false;
			return 'insufficient_nodes';
		}

		if (this._witnessServer === null) {
			this._ensuring = false;
			return 'missing_witness_server';
		}

		this._ensuring = false;
		return 'nothing_to_do';

	}

	async ensure () {

		if (this._ensuring)
			return 'aborted';

		this._ensuring = true;

		if (!this._witnessServer) {
			this._ensuring = true;
			return 'waiting_for_witness_server';
		}

		await this._quorum.elect();

		if (this._quorum.isLeader)
			return await this._ensureLeader();

		this._ensuring = false;
		return 'nothing_to_do';

	}

}

RedisCluster.cluster = new RedisCluster();

module.exports = RedisCluster;

'use strict';
const os = require('os');
const Quorum = require('./quorum.js');
const {logger} = require('./logger');
const Healthcheck = require('./healthcheck.js');
const EventEmitter = require('events');
const RedisCli = require('./redis-cli.js');

class RedisCluster extends EventEmitter {

	constructor () {

		super();

		this._ensuring = false;
		this._quorum = new Quorum(this);
		this._localNode = null;
		this._standaloneNode = null;
		this._nodes = new Map();
		this._creatingCluster = false;

	}

	get quorum () {
		return this._quorum;
	}

	get nodes () {
		return this._nodes;
	}

	setLocalNode (node) {
		this._localNode = node;
		return this;
	}

	getLocalNode () {
		return this._localNode;
	}

	setStandaloneNode (node) {
		this._standaloneNode = node;
		return this;
	}

	getStandaloneNode () {
		return this._standaloneNode;
	}

	getLeader () {

		for (const node of this._nodes.values()) {
			if (node.is_leader)
				return node;
		}

		return null;

	}

	async addNodeFromPeer (peer) {

		if (this._nodes.has(peer.hostname))
			return false;


		this._nodes.set(peer.hostname, peer);
		peer.redis.standalone
			.once('end', () => this.removeNodeFromPeer(peer))
			.once('error', () => this.removeNodeFromPeer(peer));
		await peer.redis.standalone.connect();

		if (this._nodes.size >= parseInt(process.env.CLUSTER_SIZE) && this._quorum.isLeader)
			this.emit('grownUp');

		return  true;

	}

	removeNodeFromPeer (peer, callPeerRemove = true) {

		if (!this._nodes.has(peer.hostname))
			return this;

		this._nodes.delete(peer.hostname);

		if (callPeerRemove)
			peer.remove();

		return  this;

	}

	isNodeHealthy (peerHostname) {
		
		const node = this._nodes.get(peerHostname);

		return
			node
			&& node.healthcheck.status === Healthcheck.STATUS.ONLINE
			&& node.redis.standalone.isConnected;
	}

	async _createCluster () {

		if (this._creatingCluster) {
			this._ensuring = false;
			return 'nothing_to_do';
		}

		this._creatingCluster = true;
		await RedisCli.createCluster(this._nodes.values());
		this._creatingCluster = false;
		return 'cluster_created';

	}

	async _ensureLeader () {

		if (this._nodes.size < parseInt(process.env.CLUSTER_SIZE)) {
			this._ensuring = false;
			return 'insufficient_nodes';
		}

		if (this._localNode) {

			const bulkString = await this._localNode.commands.cluster('info');
			const clusterInfo = this._localNode.convertBulkStringIntoObject(bulkString);

			if (clusterInfo.cluster_state === 'fail' && clusterInfo.cluster_size === '0') {
				this._ensuring = false;
				return await this._createCluster();
			}

		}

		this._ensuring = false;
		return 'nothing_to_do';

	}

	async ensure () {

		if (this._ensuring)
			return 'aborted';

		this._ensuring = true;

		try {
			await this._quorum.elect();
		} catch (error) {
			this._ensuring = false;
			throw error;
		}

		if (this._quorum.isLeader) {
			this.emit('agreed');
			return await this._ensureLeader();
		}

		const leader = this.getLeader();

		if (leader && leader.hostname !== os.hostname()) {
			process.env.CLUSTER_SIZE = parseInt(leader.cluster_size || process.env.CLUSTER_SIZE);
			this.emit('agreed');
		}

		this._ensuring = false;
		return 'nothing_to_do';

	}

}

RedisCluster.collection = new Proxy(
	new Map(),
	{
		get:(collection, name) => {

			if (!collection.has(name))
				collection.set(name, new RedisCluster());

			return collection.get(name);

		},
		deleteProperty:(collection, name) => {

			if (!collection.has(name))
				return false;

			collection.delete(name);
			return true;

		}
	}
);;

module.exports = RedisCluster;

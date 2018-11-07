'use strict';
const os = require('os');
const redis = require('redis');
const EventEmitter = require('events');
const Quorum = require('./quorum.js');
const {logger} = require('./logger');
const Healthcheck = require('./healthcheck.js');
const RedisCli = require('./redis-cli.js');
const penv = require('./penv.js');

class RedisCluster extends EventEmitter {

	constructor (env = null) {

		super();

		this._env = env || penv();
		this._ensuring = false;
		this._numerating = false;
		this._quorum = new Quorum(this._env, this);
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

	async broadcastStandaloneCommand (command, ...args) {

		return Promise.all(
			Array.from(this._nodes.values()).map(async (node) => {
				try {
					const result = await node.redis.standalone.commands[command](...args);
					return [node.hostname, {status:'success',result}]
				} catch (error) {
					return [node.hostname, {status:'error',error}];
				}
			})
		).then((results) => new Map(results));

	}

	async addNodeFromPeer (peer) {

		if (this._nodes.has(peer.hostname))
			return false;

		this._nodes.set(peer.hostname, peer);
		peer.redis.standalone
			.once('end', () => this.removeNodeFromPeer(peer))
			.once('error', () => this.removeNodeFromPeer(peer));
		await peer.redis.standalone.connect();

		if (this._nodes.size >= parseInt(this._env.CLUSTER_SIZE) && this._quorum.isLeader)
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

	areAllNodesReady () {

		for (const node of this._nodes.values()) {
			if (node.redis_node_status !== 'ready')
				return false;
		}
		return true;

	}

	async getClusterCreationTimestamp () {

		if (this._standaloneNode && this._standaloneNode.isConnected) {
			try {
				const clusterCreationTimestamp = await this._standaloneNode.commands.get(`${this._env.CLUSTER_NAMESPACE}:clusterCreationTimestamp`);
				if (clusterCreationTimestamp)
					return parseInt(clusterCreationTimestamp);
				return null;
			} catch (error) {
				if (error instanceof redis.AbortError)
					return null;
				throw error;
			}
		}

		return null;
	}

	async getClusterInformation () {

		if (this._localNode && this._localNode.isConnected) {
			try {
				const bulkString = await this._localNode.commands.cluster('info');
				return this._localNode.convertBulkStringIntoObject(bulkString);
			} catch (error) {
				if (error instanceof redis.AbortError)
					return null;
				throw error;
			}
		}

		return null;
	}

	async getClusterNodes () {

		if (this._localNode && this._localNode.isConnected) {
			try {
				return this._localNode.clusterNodes();
			} catch (error) {
				if (error instanceof redis.AbortError)
					return null;
				throw error;
			}
		}

		return null;
	}

	async _createCluster () {

		if (this._creatingCluster) {
			this._ensuring = false;
			return 'nothing_to_do';
		}

		this._creatingCluster = true;
		const clusterCreationTimestamp = Date.now();
		await RedisCli.createCluster(this._nodes.values(), this._env);
		await this.broadcastStandaloneCommand('set', `${this._env.CLUSTER_NAMESPACE}:clusterCreationTimestamp`, clusterCreationTimestamp);
		await this.broadcastStandaloneCommand('set', `${this._env.CLUSTER_NAMESPACE}:blocked`, 'no');
		this._creatingCluster = false;
		return 'cluster_created';

	}

	async _ensureLeader () {

		if (this._nodes.size < parseInt(this._env.CLUSTER_SIZE)) {
			this._ensuring = false;
			return 'insufficient_nodes';
		}

		try {
			if (!this._numerating) {
				this._numerating = true;
				await this._quorum.defineNodeNumbering();
				this._numerating = false;
				logger.trace(`Nodes enumerated`);
			}
		} catch (error) {
			this._numerating = false;
			logger.error(`Numerating error: ${logger.stringifyError(error)}`);
		}

		if (this.areAllNodesReady()) {

			const clusterInfo = await this.getClusterInformation();

			if (clusterInfo && clusterInfo.cluster_state === 'fail' && clusterInfo.cluster_size === '0') {
				this._ensuring = false;
				return await this._createCluster();
			}

		}

		this._ensuring = false;
		return 'nothing_to_do';

	}

	async _findNodeByClusterNodeId (clusterNodeId) {

		for (const node of this._nodes.values()) {
			if (!node.cluster_nodes)
				continue;
			if (node.cluster_nodes.find((clusterNode) => clusterNode.node_state.includes('myself') && clusterNode.node_id === clusterNodeId))
				return node;
		}

		return null;

	}

	async _findFirstEpochNode () {

		let clusterNodeId = null;
		let clusterNodeEpoch = null;

		for (const node of this._nodes.values()) {
			if (!node.cluster_nodes)
				continue;
			for (const clusterNode of node.cluster_nodes) {
				if (clusterNode.node_state.includes('fail'))
					continue;
				if (clusterNodeId === null) {
					clusterNodeId = clusterNode.node_id;
					clusterNodeEpoch = parseInt(clusterNode.epoch);
					continue;
				}
				clusterNodeEpoch = Math.min(parseInt(clusterNode.epoch), clusterNodeEpoch);
				if (clusterNodeEpoch === parseInt(clusterNode.epoch))
					clusterNodeId = clusterNode.node_id;
			}
		}

		if (clusterNodeId === null)
			return null;
		return this._findNodeByClusterNodeId(clusterNodeId);

	}

	async _acquireExpansionLock (node, lockName) {

		const acquired = await node.commands.setnx(`${this._env.CLUSTER_NAMESPACE}:lock:${lockName}`, os.hostname());

		return acquired === 1;

	}

	async _releaseExpansionLock (node, lockName) {

		const acquired = await node.commands.del(`${this._env.CLUSTER_NAMESPACE}:lock:${lockName}`);

		return acquired === 1;

	}

	async _expandCluster (peerNode, masterNodeId = null) {

		const hostname = os.hostname();

		if (!this._nodes.has(hostname))
			return void 0;

		logger.info(`Joining node ${hostname} through node ${peerNode.hostname}`);

		let masterNode = null;
		if (masterNodeId !== null) {
			logger.info(`Node ${hostname} will be a slave of cluster node ${masterNodeId}`);
			masterNode = this._findNodeByClusterNodeId(masterNodeId);
			if (masterNode === null) {
				logger.warn(`Node ${hostname} could not find his master, aborting operation`);
				return void 0;
			}
			const lockAcquired = await this._acquireExpansionLock(masterNode, 'slaveExpansion');
			if (!lockAcquired) {
				logger.warn(`Node ${hostname} could not acquire expansion lock to be a slave, aborting operation`);
				return void 0;	
			}
		}
		let lockNode = null;
		if (masterNodeId === null) {
			lockNode = this._findFirstEpochNode();
			if (!lockNode) {
				logger.warn(`Node ${hostname} could not find his master, aborting operation`);
				return void 0;
			}
			const lockAcquired = await this._acquireExpansionLock(lockNode, 'masterExpansion');
			if (!lockAcquired) {
				logger.warn(`Node ${hostname} could not acquire expansion lock to be a master, aborting operation`);
				return void 0;	
			}
		}
		await RedisCli.addNode(this._nodes.get(hostname), peerNode, this._env, masterNodeId);
		await this._standaloneNode.commands.set(`${this._env.CLUSTER_NAMESPACE}:clusterCreationTimestamp`, Date.now());
		if (masterNode)
			await this._releaseExpansionLock(masterNode, 'slaveExpansion');
		if (lockNode)
			await this._releaseExpansionLock(lockNode, 'masterExpansion');
		logger.info(`Node ${hostname} joined cluster`);

	}

	async _forgetFailedNodes () {

		for (const node of this._nodes.values()) {
			if (!node.cluster_nodes)
				continue;
			const failedNode = node.cluster_nodes.find((clusterNode) => clusterNode.node_state.includes('fail'))
			if (!failedNode)
				continue;
			try {
				await this._localNode.commands.cluster('forget', failedNode.node_id)
			} catch (error) {
				continue;
			}
		}

	}

	async _joinCluster () {

		const clusterCreationTimestamp = await this._standaloneNode.commands.get(`${this._env.CLUSTER_NAMESPACE}:clusterCreationTimestamp`);
		const blocked = await this._standaloneNode.commands.get(`${this._env.CLUSTER_NAMESPACE}:blocked`);

		if (clusterCreationTimestamp || blocked === 'yes') {
			if (clusterCreationTimestamp) {
				await this._forgetFailedNodes();
				await this.broadcastStandaloneCommand('set', `${this._env.CLUSTER_NAMESPACE}:blocked`, 'no');
			}
			return void 0;
		}

		if (this._nodes.size === 0)
			return void 0;

		const hostname = os.hostname();
		let peerNode = null;

		for (const node of this._nodes.values()) {
			if (node.hostname === hostname || !node.cluster_nodes)
				continue;
			if (node.cluster_nodes && node.cluster_nodes.find((clusterNode) => clusterNode.node_state.includes('fail')))
				continue;
			peerNode = node;
			break;
		}

		if (peerNode === null)
			return void 0;

		// Checks what it needs
		let masterCount = 0;
		let slaveCount = 0;
		let clusterRelation = new Map();
		for (const clusterNode of peerNode.cluster_nodes) {
			if (clusterNode.node_state.includes('master')) {
				if (!clusterRelation.has(clusterNode.node_id))
					clusterRelation.set(clusterNode.node_id, new Set());
				masterCount++;
				continue;
			}
			if (!clusterRelation.has(clusterNode.node_master))
				clusterRelation.set(clusterNode.node_master, new Set());
			clusterRelation.get(clusterNode.node_master).add(clusterNode.node_id);
			slaveCount++;
		}

		if (masterCount*parseInt(this._env.CLUSTER_REPLICAS) !== slaveCount) {
			// Check wich master needs a slave
			let mostAloneMaster = {nodeId:null, slaveCount:null};
			for (const [nodeId, slaves] of clusterRelation) {
				if (mostAloneMaster.slaveCount === null) {
					mostAloneMaster.nodeId = nodeId;
					mostAloneMaster.slaveCount = slaves.size;
					continue;
				}
				mostAloneMaster.slaveCount = Math.min(slaves.size, mostAloneMaster.slaveCount);
				if (mostAloneMaster.slaveCount === slaves.size)
					mostAloneMaster.nodeId = nodeId;
			}
			if (mostAloneMaster.nodeId !== null) {
				await this._expandCluster(peerNode, mostAloneMaster.nodeId);
				return void 0;
			}
		}
		// Add a master
		await this._expandCluster(peerNode);

	}

	async _ensureBlockedFlag () {

		const blocked = await this._standaloneNode.commands.get(`${this._env.CLUSTER_NAMESPACE}:blocked`);

		if (!blocked)
			await this._standaloneNode.commands.set(`${this._env.CLUSTER_NAMESPACE}:blocked`, 'yes');

	}

	async ensure () {

		if (this._ensuring)
			return 'aborted';

		if (!this._standaloneNode || !this._standaloneNode.isConnected)
			return 'waiting';

		await this._ensureBlockedFlag();

		this._ensuring = true;

		try {
			await this._quorum.elect();
		} catch (error) {
			this._ensuring = false;
			throw error;
		}

		if (this._quorum.isLeader) {
			const action = await this._ensureLeader();
			await this._joinCluster();
			this.emit('agreed');
			return action;
		}

		const leader = this.getLeader();

		if (leader && leader.hostname !== os.hostname()) {
			this._env.CLUSTER_SIZE = parseInt(leader.cluster_size || this._env.CLUSTER_SIZE);
			this.emit('agreed');
		}

		await this._joinCluster();
		this._ensuring = false;
		return 'nothing_to_do';

	}

}

module.exports = RedisCluster;

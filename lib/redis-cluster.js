'use strict';
const os = require('os');
const redis = require('redis');
const EventEmitter = require('events');
const Quorum = require('./quorum.js');
const {logger} = require('./logger');
const Healthcheck = require('./healthcheck.js');
const RedisCli = require('./redis-cli.js');
const penv = require('./penv.js');
const sleep = require('./sleep.js');
const {REDIS_SLOTS} = require('./constants.js');
const randomInteger = require('./random-integer.js');

class RedisCluster extends EventEmitter {

	constructor (env = null) {

		super();

		this._env = env || penv();
		this._ensuring = false;
		this._numerating = false;
		this._expanding = false;
		this._quorum = new Quorum(this._env, this);
		this._localNode = null;
		this._standaloneNode = null;
		this._nodes = new Map();
		this._creatingCluster = false;
		this._integerStamp = randomInteger();

	}

	get quorum () {
		return this._quorum;
	}

	get nodes () {
		return this._nodes;
	}

	get integerStamp () {
		return this._integerStamp;
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
					return [node.hostname, {status:'success', result}];
				} catch (error) {
					return [node.hostname, {status:'error', error}];
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

		return true;

	}

	removeNodeFromPeer (peer, callPeerRemove = true) {

		if (!this._nodes.has(peer.hostname))
			return this;

		this._nodes.delete(peer.hostname);

		if (callPeerRemove)
			peer.remove();

		return this;

	}

	isNodeHealthy (peerHostname) {

		const node = this._nodes.get(peerHostname);

		return node
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
		await this._quorum.defineNodeNumbering('master');
		await this._quorum.defineNodeNumbering('slave');
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
				logger.trace('Nodes enumerated');
			}
		} catch (error) {
			this._numerating = false;
			logger.error(`Numerating error: ${logger.stringifyError(error)}`);
		}

		if (this.areAllNodesReady()) {

			const clusterInfo = await this.getClusterInformation();

			if (clusterInfo && clusterInfo.cluster_state === 'fail' && (clusterInfo.cluster_size === '0' || clusterInfo.cluster_size === '1')) {
				this._ensuring = false;
				return await this._createCluster();
			}

		}

		this._ensuring = false;
		return 'nothing_to_do';

	}

	_findNodeByClusterNodeId (clusterNodeId) {

		for (const node of this._nodes.values()) {
			if (!node.cluster_nodes)
				continue;
			if (node.cluster_nodes.find((clusterNode) => clusterNode.node_state.includes('myself') && clusterNode.node_id === clusterNodeId))
				return node;
		}

		return null;

	}

	_findFirstEpochNode () {

		const hostname = os.hostname();
		let clusterNodeId = null;
		let clusterNodeEpoch = null;

		for (const node of this._nodes.values()) {
			if (!node.cluster_nodes || !node.cluster_creation_timestamp || node.hostname === hostname)
				continue;
			for (const clusterNode of node.cluster_nodes) {
				if (clusterNode.node_state.split(',').includes('fail'))
					continue;
				let epoch = parseInt(clusterNode.epoch);
				if (epoch === 0)
					continue;
				epoch = epoch+node.node_number-node.cluster_creation_timestamp;
				if (clusterNodeId === null) {
					clusterNodeId = clusterNode.node_id;
					clusterNodeEpoch = epoch;
					continue;
				}
				clusterNodeEpoch = Math.min(epoch, clusterNodeEpoch);
				if (clusterNodeEpoch === epoch)
					clusterNodeId = clusterNode.node_id;
			}
		}

		if (clusterNodeId === null)
			return null;
		return this._findNodeByClusterNodeId(clusterNodeId);

	}

	async _acquireExpansionLock (node, lockName = 'expansion') {

		const acquired = await node.redis.standalone.commands.setnx(`${this._env.CLUSTER_NAMESPACE}:lock:${lockName}`, os.hostname());

		return acquired === 1;

	}

	async _releaseExpansionLock (node, lockName = 'expansion') {

		const acquired = await node.redis.standalone.commands.del(`${this._env.CLUSTER_NAMESPACE}:lock:${lockName}`);

		return acquired === 1;

	}

	async _reshard (peerNode) {
		const hostname = os.hostname();
		const clusterInfo = await this.getClusterInformation();
		if (clusterInfo.cluster_state !== 'ok') {
			logger.warn(`Cluster state must be ok to reshard node ${hostname}, current state is ${clusterInfo.cluster_state}`);
			await sleep(parseInt(this._env.PROCESS_INTERVAL));
			await this._reshard(peerNode);
			return void 0;
		}
		const clusterNodes = await this.getClusterNodes();
		const myself = clusterNodes.find((clusterNode) => clusterNode.node_state.includes('myself'));
		let masterCount = 0;
		for (const clusterNode of peerNode.cluster_nodes) {
			if (clusterNode.node_state.includes('master') && !clusterNode.node_state.split(',').includes('fail') && clusterNode.node_id !== myself.node_id)
				masterCount++;
		}
		const numberOfSlots = Math.ceil(REDIS_SLOTS/masterCount);
		logger.info(`Resharding ${numberOfSlots} slots for node ${hostname}`);
		await RedisCli.reshard(peerNode, myself.node_id, numberOfSlots, this._env);
		logger.info(`${numberOfSlots} resharded for node ${hostname}`);
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
			const lockAcquired = await this._acquireExpansionLock(masterNode);
			if (!lockAcquired) {
				logger.warn(`Node ${hostname} could not acquire expansion lock to be a slave, aborting operation`);
				return void 0;
			}
		}
		let lockNode = null;
		if (masterNodeId === null) {
			lockNode = this._findFirstEpochNode();
			if (!lockNode) {
				logger.warn(`Node ${hostname} could not find his lock node, aborting operation`);
				return void 0;
			}
			const lockAcquired = await this._acquireExpansionLock(lockNode);
			if (!lockAcquired) {
				logger.warn(`Node ${hostname} could not acquire expansion lock to be a master, aborting operation`);
				return void 0;
			}
		}
		try {
			await RedisCli.addNode(this._nodes.get(hostname), peerNode, this._env, masterNodeId);
			await this._standaloneNode.commands.set(`${this._env.CLUSTER_NAMESPACE}:clusterCreationTimestamp`, Date.now());
			logger.info(`Node ${hostname} joined cluster`);
			if (lockNode)
				await this._reshard(peerNode);
		} catch (error) {
			logger.error(`Node ${hostname} had error while joining the cluster: ${logger.stringifyError(error)}`);
		} finally {
			if (masterNode || lockNode)
				await this._releaseExpansionLock(masterNode || lockNode);
		}

	}

	async _forgetFailedNodes () {

		const forgotten = new Set();
		for (const node of this._nodes.values()) {
			if (!node.cluster_nodes)
				continue;
			const failedNode = node.cluster_nodes.find((clusterNode) => clusterNode.node_state.split(',').includes('fail'));
			if (!failedNode || forgotten.has(failedNode.node_id))
				continue;
			if (failedNode.node_state.split(',').includes('master') && node.cluster_nodes.find((clusterNode) => clusterNode.node_master === failedNode.node_id))
				continue;
			try {
				await this._localNode.commands.cluster('forget', failedNode.node_id);
				forgotten.add(failedNode.node_id);
				logger.info(`Node ${failedNode.node_id} forgot`);
			} catch (error) {
				logger.warn(`Failed to forget node ${failedNode.node_id}: ${logger.stringifyError(error)}`);
			}
		}

	}

	async _failoverFailingMaster () {

		let masterNode = null;
		let lockNode = null;
		let action = 'force';
		try {
			const hostname = os.hostname();
			const clusterNodes = await this.getClusterNodes();
			const myself = clusterNodes.find((clusterNode) => clusterNode.node_state.includes('myself,slave'));
			if (!myself)
				return void 0;
			const master = clusterNodes.find((clusterNode) => clusterNode.node_id === myself.node_master && (clusterNode.node_state.split(',').includes('fail') || clusterNode.node_state.split(',').includes('fail?')));
			if (!master)
				return void 0;
			masterNode = this._findNodeByClusterNodeId(master.node_id);
			if (masterNode)
				return void 0;
			if (master.node_state.split(',').includes('fail?'))
				action = 'takeover';
			lockNode = this._findFirstEpochNode();
			if (!lockNode) {
				logger.warn(`Node ${hostname} could not find his lock node, aborting operation`);
				return void 0;
			}
			const lockAcquired = await this._acquireExpansionLock(lockNode);
			if (!lockAcquired) {
				logger.warn(`Node ${hostname} could not acquire expansion lock to failover (${action}), aborting operation`);
				return void 0;
			}
			logger.info(`Node ${hostname} will failover (${action}) master ${master.node_id}`);
		} catch (error) {
			logger.error(`Failed to failover (${action}): ${logger.stringifyError(error)}`);
			return void 0;
		}
		try {
			await this._localNode.commands.cluster('failover', action);
			this._quorum.unsetNodeNumber('slave');
			this.emit('failover');
			logger.info('I\'m the new master!');
		} catch (error) {
			logger.error(`Failed to failover (${action}): ${logger.stringifyError(error)}`);
		} finally {
			await this._releaseExpansionLock(lockNode);
		}

	}

	async _joinCluster () {

		if (this._expanding || !this._localNode || !this._localNode.isConnected)
			return void 0;

		this._expanding = true;

		const clusterCreationTimestamp = await this._standaloneNode.commands.get(`${this._env.CLUSTER_NAMESPACE}:clusterCreationTimestamp`);
		const blocked = await this._standaloneNode.commands.get(`${this._env.CLUSTER_NAMESPACE}:blocked`);

		if (clusterCreationTimestamp || blocked === 'yes') {
			if (clusterCreationTimestamp) {
				await this._forgetFailedNodes();
				await this._failoverFailingMaster();
				await this.broadcastStandaloneCommand('set', `${this._env.CLUSTER_NAMESPACE}:blocked`, 'no');
				if (this._quorum.isLeader) {
					await this._quorum.defineNodeNumbering('master');
					await this._quorum.defineNodeNumbering('slave');
				}
				this.emit('clusterized');
			}
			this._expanding = false;
			return void 0;
		}

		if (this._nodes.size === 0) {
			this._expanding = false;
			return void 0;
		}

		const hostname = os.hostname();
		let peerNode = null;

		for (const node of this._nodes.values()) {
			if (!node.cluster_creation_timestamp || node.hostname === hostname || !node.cluster_nodes)
				continue;
			if (node.cluster_nodes && node.cluster_nodes.find((clusterNode) => clusterNode.node_state.split(',').includes('fail')))
				continue;
			peerNode = node;
			break;
		}

		if (peerNode === null) {
			this._expanding = false;
			return void 0;
		}

		// Checks what it needs
		let masterCount = 0;
		let slaveCount = 0;
		let clusterRelation = new Map();
		for (const clusterNode of peerNode.cluster_nodes) {
			if (clusterNode.node_state.split(',').includes('fail') || !this._findNodeByClusterNodeId(clusterNode.node_id))
				continue;
			if (clusterNode.node_state.includes('master')) {
				if (!clusterRelation.has(clusterNode.node_id))
					clusterRelation.set(clusterNode.node_id, new Set());
				masterCount++;
				continue;
			}
			if (!clusterNode.node_state.includes('slave'))
				continue;
			if (!clusterRelation.has(clusterNode.node_master))
				clusterRelation.set(clusterNode.node_master, new Set());
			clusterRelation.get(clusterNode.node_master).add(clusterNode.node_id);
			slaveCount++;
		}

		if (masterCount*parseInt(this._env.CLUSTER_REPLICAS) > slaveCount) {
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
				this._expanding = false;
				return void 0;
			}
			this._expanding = false;
			return void 0;
		}
		// Add a master
		await this._expandCluster(peerNode);
		this._expanding = false;

	}

	async _ensureBlockedFlag () {

		const blocked = await this._standaloneNode.commands.get(`${this._env.CLUSTER_NAMESPACE}:blocked`);

		if (!blocked)
			await this._standaloneNode.commands.set(`${this._env.CLUSTER_NAMESPACE}:blocked`, 'yes');

	}

	async _ensure () {

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
			this._env.CLUSTER_REPLICAS = parseInt(leader.cluster_replicas || this._env.CLUSTER_REPLICAS);
			this.emit('agreed');
		}

		await this._joinCluster();
		this._ensuring = false;
		return 'nothing_to_do';

	}

	async ensure () {

		try {
			return await this._ensure();
		} catch (error) {
			logger.error(`Ensuring cluster error: ${logger.stringifyError(error)}`);
			this._ensuring = false;
			return 'ensure_error';
		}

	}

}

module.exports = RedisCluster;

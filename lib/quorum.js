'use strict';
const EventEmitter = require('events');
const os = require('os');
const sleep = require('./sleep.js');
const majorityNumber = require('./majority-number.js');
const {logger} = require('./logger.js');
const penv = require('./penv.js');
const {QUORUM_RANDOM_LIMIT} = require('./constants.js');
const ClusterHelpers = require('./cluster-helpers.js');

class Quorum extends EventEmitter {

	constructor (env = null, cluster) {

		super();

		this._env = env || penv();
		this._cluster = cluster;
		this._isLeader = false;
		this._electing = false;
		this._isNumerating = false;
		this._acksCount = 0;

	}

	get isLeader () {
		return this._isLeader;
	}

	async getLeaderHostname () {

		const standaloneNode = this._cluster.getStandaloneNode();

		if (!standaloneNode)
			return null;

		return await standaloneNode.commands.get(`${this._env.CLUSTER_NAMESPACE}:leader`);

	}

	async getNodeNumber (category = null) {

		const standaloneNode = this._cluster.getStandaloneNode();
		category = category || 'node';
		if (!standaloneNode)
			return null;
		const nodeNumber = await standaloneNode.commands.get(`${this._env.CLUSTER_NAMESPACE}:number:${category}`);
		if (!nodeNumber)
			return null;
		return parseInt(nodeNumber);

	}

	async unsetNodeNumber (category = null) {
		const standaloneNode = this._cluster.getStandaloneNode();
		category = category || 'node';
		await standaloneNode.commands.del(`${this._env.CLUSTER_NAMESPACE}:number:${category}`);
	}

	async _touchTtl (node, ttl = null) {

		const key = `${this._env.CLUSTER_NAMESPACE}:leader`;
		await node.redis.standalone.commands.pexpire(key, ttl || parseInt(this._env.LEADER_TTL));

	}

	async amIBeingLed (leaderHostname = null) {

		leaderHostname = leaderHostname || await this.getLeaderHostname();

		return leaderHostname
			&& leaderHostname !== os.hostname()
			&& this._cluster.isNodeHealthy(leaderHostname)
			&& this._cluster.get(leaderHostname).is_leader;

	}

	async giveUp (nodes = null) {

		nodes = nodes || Array.from(this._cluster.nodes.values());
		const key = `${this._env.CLUSTER_NAMESPACE}:leader`;
		const hostname = os.hostname();

		logger.trace(`Giving up (${nodes.length} node(s))`);

		return Promise.all(
			nodes.map(async (node) => {

				const leaderHostname = await node.redis.standalone.commands.get(key);

				if (leaderHostname === hostname)
					await node.redis.standalone.commands.del(key);

			})
		);

	}

	async elect () {

		if (this._electing)
			return this._isLeader;

		this._electing = true;
		this.emit('electing');

		const clusterSize = parseInt(this._env.CLUSTER_SIZE);
		const majority = majorityNumber(clusterSize);
		const key = `${this._env.CLUSTER_NAMESPACE}:leader`;
		const actualLeaderHostname = await this.getLeaderHostname();
		const hostname = os.hostname();
		const nodes = Array.from(this._cluster.nodes.values());
		const leadingNodes = [];
		const countLeadingPeerNode = {};
		let integerStampCutoff = nodes.map((node) => node.integer_stamp).sort((a, b) => a-b);
		if (integerStampCutoff.length > 0)
			integerStampCutoff = integerStampCutoff[Math.ceil((integerStampCutoff.length-1)/2)];
		let leadingTotalAmount = 0;
		const addCountPeerNode = (nodeHostname) => {
			leadingTotalAmount++;
			if (Reflect.has(countLeadingPeerNode, nodeHostname))
				return countLeadingPeerNode[nodeHostname]++;
			countLeadingPeerNode[nodeHostname] = 1;
			return countLeadingPeerNode[nodeHostname];
		};
		const getGreatestLeader = () => {
			let leaderCount = 0;
			for (const nodeHostname in countLeadingPeerNode)
				leaderCount = Math.max(leaderCount, countLeadingPeerNode[nodeHostname]);
			return leaderCount;
		};
		const areAllLeadingSameAmount = () => {
			let leadingAmount = null;
			for (const nodeHostname in countLeadingPeerNode) {
				if (countLeadingPeerNode[nodeHostname] === 0)
					continue;
				if (leadingAmount === null) {
					leadingAmount = countLeadingPeerNode[nodeHostname];
					continue;
				}
				if (leadingAmount !== countLeadingPeerNode[nodeHostname])
					return false;
			}
			return leadingAmount !== null;
		};

		return Promise.all(
			nodes.map(async (node) => {

				try {

					if (this._cluster.integerStamp <= integerStampCutoff)
						return false;

					const sleepTtl = Math.floor(Math.random()*parseInt(this._env.LEADER_TTL)*QUORUM_RANDOM_LIMIT);
					await sleep(sleepTtl);

					if (await this.amIBeingLed(actualLeaderHostname))
						return false;

					const acquired = await node.redis.standalone.commands.setnx(key, hostname);

					if (acquired > 0) {
						await this._touchTtl(node);
						addCountPeerNode(hostname);
						return true;
					}

					const leaderHostname = await node.redis.standalone.commands.get(key);
					addCountPeerNode(leaderHostname);

					if (leaderHostname === hostname) {
						leadingNodes.push(node);
						let ttl = parseInt(this._env.LEADER_TTL);
						if (!this._isLeader)
							ttl -= sleepTtl;
						await this._touchTtl(node, ttl);
						return true;
					}

					return false;
				} catch (error) {
					logger.warn(`Leader quorum error for node ${node.hostname}: ${logger.stringifyError(error)}`);
					return false;
				}

			})
		).then((leadingCount) => {

			leadingCount = leadingCount.filter((acquired) => acquired).length;

			if (
				leadingCount > 0
				&& leadingCount !== clusterSize
				&& (
					getGreatestLeader() > leadingCount
					|| (areAllLeadingSameAmount() && leadingTotalAmount >= clusterSize)
					|| leadingCount < Math.floor(clusterSize/2)
				)
			)
				return this.giveUp(leadingNodes).then(() => {
					return leadingCount;
				});

			return leadingCount;

		}).then((leadingCount) => {

			logger.trace(`Leading count: ${leadingCount}/${nodes.length} (expected total: ${this._env.CLUSTER_SIZE})`);

			if (leadingCount >= majority) {
				this._acksCount++;
				if (this._acksCount >= parseInt(this._env.LEADER_REQUIRED_ACKS)) {
					this._isLeader = true;
					return true;
				}
				this._isLeader = false;
				return false;
			}

			this._acksCount = 0;
			this._isLeader = false;
			return false;

		}).finally(() => {
			this._electing = false;
			this.emit('elected');
		});

	}

	async defineNodeNumbering (category = null) {

		const size = parseInt(this._env.CLUSTER_SIZE);
		const numbers = new Set();
		const usedNumbers = new Set();

		for (let x = 0;x < size; x++)
			numbers.add(x);

		category = category || 'node';

		const numberKey = `${this._env.CLUSTER_NAMESPACE}:number:${category}`;
		const numbering = await this._cluster.broadcastStandaloneCommand('get', numberKey);
		let nodesWithoutNumber = [];

		for (const [nodeHostname, response] of numbering) {

			if (response.status === 'error')
				continue;

			response.result = parseInt(response.result);

			if (isNaN(response.result)) {
				nodesWithoutNumber.push(nodeHostname);
				continue;
			}

			numbers.delete(response.result);
			usedNumbers.add(response.result);

		}

		if (category !== 'node')
			nodesWithoutNumber = nodesWithoutNumber.filter((nodeHostname) => {
				const nodeWithoutNumber = this._cluster.nodes.get(nodeHostname);
				return nodeWithoutNumber
					&& nodeWithoutNumber.cluster_creation_timestamp
					&& nodeWithoutNumber.cluster_nodes
					&& nodeWithoutNumber.cluster_nodes.filter(
						(clusterNode) => ClusterHelpers.isMyself(clusterNode)
						&& clusterNode.node_state.includes(category)
					).length === 1;
			});

		for (const nodeHostname of nodesWithoutNumber) {

			let nodeNumber = null;

			if (numbers.size > 0) {
				nodeNumber = numbers.values().next().value;
				numbers.delete(nodeNumber);
			}

			if (nodeNumber === null) {

				nodeNumber = size;

				if (usedNumbers.size > 0) {
					const sortedUsedNumbers = Array.from(usedNumbers.values()).sort((a, b) => a-b);
					let lastNumber = null;
					for (const usedNumber of sortedUsedNumbers) {

						if (lastNumber === null) {
							lastNumber = usedNumber;
							nodeNumber = lastNumber+1;
							continue;
						}

						if (usedNumber-lastNumber > 1) {
							nodeNumber = lastNumber+1;
							break;
						} else if (lastNumber-usedNumber > 1) {
							nodeNumber = usedNumber+1;
							break;
						}

						lastNumber = usedNumber;
						nodeNumber = lastNumber+1;

					}
				}

			}

			usedNumbers.add(nodeNumber);
			try {
				await this._cluster.nodes.get(nodeHostname).redis.standalone.commands.set(numberKey, nodeNumber);
			} catch (error) {
				logger.warn(`Error numbering node ${nodeHostname}: ${logger.stringifyError(error)}`);
			}

		}

	}

}

module.exports = Quorum;
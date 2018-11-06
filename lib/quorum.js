'use strict';
const EventEmitter = require('events');
const os = require('os');
const Healthcheck = require('./healthcheck.js');
const sleep = require('./sleep.js');
const majorityNumber = require('./majority-number.js');
const {logger} = require('./logger.js');

class Quorum extends EventEmitter {

	constructor (cluster) {

		super();

		this._cluster = cluster;
		this._isLeader = false;
		this._nodeNumber = null;
		this._electing = false;

	}

	get isLeader () {
		return this._isLeader;
	}

	get nodeNumber () {
		//return this._isLeader;
	}

	async getLeaderHostname () {
		
		const standaloneNode = this._cluster.getStandaloneNode();
		
		if (!standaloneNode)
			return null;

		return await standaloneNode.commands.get(`${process.env.CLUSTER_NAMESPACE}:leader`);

	}

	async _touchTtl (node, ttl = null) {

		const key = `${process.env.CLUSTER_NAMESPACE}:leader`;
		await node.redis.standalone.commands.pexpire(key, ttl || parseInt(process.env.LEADER_TTL));

	}

	async amIBeingLed (leaderHostname = null) {

		leaderHostname = leaderHostname || await this.getLeaderHostname();

		return
			leaderHostname
			&& leaderHostname !== os.hostname()
			&& this._cluster.isNodeHealthy(leaderHostname)
			&& this._cluster.get(leaderHostname).is_leader;

	}

	async elect () {

		if (this._electing)
			return this._isLeader;

		this._electing = true;
		this.emit('electing');

		const majority = majorityNumber(process.env.CLUSTER_SIZE);
		const key = `${process.env.CLUSTER_NAMESPACE}:leader`;
		const actualLeaderHostname = await this.getLeaderHostname();
		const hostname = os.hostname();
		const nodes = Array.from(this._cluster.nodes.values());
		let otherLeadersCount = 0;

		return Promise.all(
			nodes.map(async (node) => {

				await sleep(Math.floor(Math.random()*parseInt(process.env.LEADER_TTL*0.25)));

				if (await this.amIBeingLed(actualLeaderHostname))
					return false;

				if (otherLeadersCount >= parseInt(process.env.CLUSTER_SIZE)/2)
					return false;

				const acquired = await node.redis.standalone.commands.setnx(key, hostname);

				if (acquired > 0) {
					await this._touchTtl(node, parseInt(process.env.LEADER_TTL*0.75));
					return true;
				}

				const leaderHostname = await node.redis.standalone.commands.get(key);

				if (leaderHostname === hostname) {
					if (this._isLeader)
						await this._touchTtl(node);
					return true;
				}

				otherLeadersCount++;
				return false;

			})
		).then((leadingCount) => {
			
			leadingCount = leadingCount.filter((acquired) => acquired);

			logger.trace(`Leading count: ${leadingCount.length}/${nodes.length}`);

			if (leadingCount.length >= majority) {
				this._isLeader = true;
				return true;
			}

			this._isLeader = false;
			return false;

		}).finally(() => {
			this._electing = false;
			this.emit('elected');
		});

	}

	/*async acquireNodeNumbering () {

		const size = parseInt(process.env.CLUSTER_SIZE || 3);
		const numbers = new Set();
		
		for (let x = 0;x < size; x++)
			numbers.add(x);
		
		const setKey = `${process.env.CLUSTER_NAMESPACE}:numbering`;

		let numbering = await this._cluster.witnessServer.redis.commands.hgetall(setKey);
		let maxNumber = size-1;

		numbering = numbering || {};

		Object.keys(numbering).forEach((number) => {
			number = parseInt(number);
			maxNumber = Math.max(maxNumber, number);
			numbers.delete(number);
			return true;
		});
		if (numbering)
	}*/

}

module.exports = Quorum;
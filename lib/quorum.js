'use strict';
const EventEmitter = require('events');
const os = require('os');

class Quorum extends EventEmitter {

	constructor (cluster) {

		super();

		this._cluster = cluster;
		this._isLeader = false;
		this._nodeNumber = null;
		this._leaderHostname = null;
		this._electing = false;

	}

	get isLeader () {
		return this._isLeader;
	}

	get nodeNumber () {
		return this._isLeader;
	}

	get leaderHostname () {
		return this._leaderHostname;
	}

	async _touchTtl () {

		const key = `${process.env.CLUSTER_NAMESPACE}:leader`;
		await this._cluster.witnessServer.redis.commands.pexpire(
			key,
			parseInt(process.env.LEADER_TTL || 1000)
		);

	}

	async elect () {

		if (this._electing)
			return this._isLeader;

		this._electing = true;
		this.emit('electing');

		const key = `${process.env.CLUSTER_NAMESPACE}:leader`;
		const hostname = os.hostname();
		const isLeader = await this._cluster.witnessServer.redis.commands.setnx(
			key,
			hostname
		);

		if (isLeader > 0) {
			await this._touchTtl();
			this._isLeader = true;
			this._electing = false;
			this._leaderHostname = hostname;
			this.emit('leading');
			return true;
		}

		this._leaderHostname = await this._cluster.witnessServer.redis.commands.get(
			key
		);

		if (this._leaderHostname === hostname) {
			await this._touchTtl();
			this._isLeader = true;
			this._electing = false;
			this.emit('leading');
			return true;
		}

		this._isLeader = false;
		this._electing = false;
		this.emit('obeying');
		return true;

	}

	async acquireNodeNumbering () {

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
	}

}

module.exports = Quorum;
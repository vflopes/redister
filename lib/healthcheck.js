'use strict';
const EventEmitter = require('events');
const request = require('request-promise-native');

class Healthcheck extends EventEmitter {

	constructor (peer) {

		super();

		this._peer = peer;
		this._locked = false;
		this._interval = null;
		this._status = Healthcheck.STATUS.UNKNOWN;

	}

	get status () {
		return this._status;
	}

	stop () {

		if (this._interval) {
			clearInterval(this._interval);
			this._interval = null;
			this.emit('stopped');
		}

		return this;

	}

	async _check () {

		const peerInformation = await request({uri:`http://${this._peer.hostname}:${this._peer.http_port}/me`,json:true});
		
		Object.keys(peerInformation.data).forEach((key) => {
			this._peer[key] = peerInformation.data[key];
		});

		this.emit('check');

	}

	run (healthcheckInterval = 100) {

		this.stop();
		this._interval = setInterval(async () => {

			if (this._locked) {
				this.emit('aborted');
				return void 0;
			}

			this._locked = true;
			this.emit('locked');

			try {
				await this._check();
				this._state = Healthcheck.STATUS.ONLINE;
				this.emit('online');
			} catch (error) {
				this._state = Healthcheck.STATUS.OFFLINE;
				this.emit('offline');
				this.emit('error', error);
			} finally {
				this._locked = false;
				this.emit('unlocked');
			}

		}, healthcheckInterval);

		this.emit('running');

		return this;

	}

}

Healthcheck.STATUS = {
	ONLINE:Symbol('ONLINE'),
	OFFLINE:Symbol('OFFLINE'),
	UNKNOWN:Symbol('UNKNOWN')
};

module.exports = Healthcheck;
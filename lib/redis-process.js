'use strict';
const EventEmitter = require('events');
const shortid = require('shortid');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {spawn} = require('child_process');
const {logger} = require('./logger.js');

class RedisProcess extends EventEmitter {

	constructor () {

		super();

		this._process = null;
		this._configs = new Map();
		this._status = 'unknown';

		process.on('SIGTERM', () => this.end());

	}

	get status () {
		return this._status;
	}

	end () {

		if (this._process === null)
			return this;

		this._process.kill('SIGTERM');
		this._status = 'ended';
		this.emit('end');
		return this;

	}

	setConfig (name, value) {
		this._configs.set(name, value);
		return this;
	}

	unsetConfig (name) {
		this._configs.delete(name);
		return this;
	}

	_prepareConfig (sourceConfig) {

		const targetFilePath = path.join(os.homedir(), shortid.generate()+'.conf');

		fs.readFileSync(sourceConfig).toString('utf8').split('\n').forEach((line) => {

			line = line.trim();

			const separatorPosition = line.indexOf(' ');

			if (separatorPosition === -1)
				return true;

			const name = line.substring(0, separatorPosition).toLowerCase();

			if (!this._configs.has(name))
				this._configs.set(
					name,
					line.substring(separatorPosition+1)
				);

		});

		fs.writeFileSync(
			targetFilePath,
			Array.from(this._configs.entries()).map(([key, value]) => `${key.toLowerCase()} ${value}`).join('\n'),
			'utf8'
		);

		return targetFilePath;

	}

	start (configPath = '/usr/local/etc/redis/redis.conf') {

		this._status = 'started';
		this._process = spawn('redis-server', [this._prepareConfig(configPath)]);
		const source = {address:os.hostname(), trackerId:`redis-${this._process.pid}`};
		this._process.stdout.on('data', (data) => {

			data = data.toString('utf8');
			logger.debug(source, data.replace(/\n/g, '|'));

			if (data.toLowerCase().includes('ready to accept')) {
				this._status = 'ready';
				this.emit('ready');
			}

		});
		this._process.stderr.on('data', (data) => logger.error(source, data.toString('utf8').replace(/\n/g, '|')));
		this._process.on('close', () => {
			this._process = null;
			this._status = 'closed';
			this.emit('close');
		});
		this.emit('start');
		return this;

	}

}

module.exports = RedisProcess;
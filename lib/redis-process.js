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
		process.on('SIGTERM', () => this.end());

	}

	end () {

		if (this._process === null)
			return this;

		this._process.kill('SIGTERM');
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

		this._process = spawn('redis-server', [this._prepareConfig(configPath)]);
		const source = {address:'redis', trackerId:this._process.pid};
		this._process.stdout.on('data', (data) => {
			
			logger.debug(source, data);

			if (data.toString('utf8').toLowerCase().includes('ready to accept'))
				this.emit('ready');

		});
		this._process.stderr.on('data', (data) => logger.error(source, data));
		this._process.on('close', () => {
			this._process = null;
			this.emit('close');
		});
		this.emit('start');
		return this;

	}

}

RedisProcess.collection = new Proxy(
	new Map(),
	{
		get:(collection, name) => {

			if (!collection.has(name))
				collection.set(name, new RedisProcess());

			return collection.get(name);

		},
		deleteProperty:(collection, name) => {

			if (!collection.has(name))
				return false;

			collection.get(name).end();
			collection.delete(name);
			return true;

		}
	}
);

module.exports = RedisProcess;
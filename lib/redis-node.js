'use strict';
const redis = require('redis');
const util = require('util');
const EventEmitter = require('events');
const {logger} = require('./logger');
const {REDIS_PORT} = require('./constants.js');

class RedisNode extends EventEmitter {

	constructor (peer = null, type = null) {

		super();

		this._peer = peer;
		this._type = type;
		this._client = null;
		this._commands = {};
		this._commandsProxy = null;
		this.on('error', (error) => {
			if (peer)
				peer.remove();
			this.disconnect(true);
			logger.error(`Redis node (${peer.hostname}) connection error: ${logger.stringifyError(error)}`);
		});

	}

	convertBulkStringIntoObject (bulkString) {
		return RedisNode.convertBulkStringIntoObject(bulkString);
	}

	static convertBulkStringIntoObject (bulkString) {

		const object = {};
		bulkString.replace(/\r/ig, '').split('\n').forEach((item) => {
			const separatorIndex = item.indexOf(':');
			const key = item.substring(0, separatorIndex);
			if (key.length === 0)
				return true;
			object[key] = item.substring(separatorIndex+1);
		});
		return object;

	}

	get client () {
		return this._client;
	}

	get commands () {
		return this._commandsProxy;
	}

	get isConnected () {
		return this._client && this._client.connected;
	}

	async clusterNodes () {

		const result = await this._commandsProxy.cluster('nodes');

		return result.split('\n').map((line) => {
			const [node_id, node_address, node_state, node_master, ping_sent, pong_recv, epoch] = line.trim().replace(/\r/ig, '').split(/\s/);
			if (!node_id)
				return null;
			return {node_id, node_address, node_state:node_state.split(','), node_master, ping_sent, pong_recv, epoch};
		}).filter((nodeInfo) => nodeInfo !== null);

	}

	async disconnect (force = false) {

		if (this._client === null || !this._client.connected) {
			this._client = null;
			return void 0;
		}

		if (force) {
			this._client.end(true);
			this._client = null;
			this.emit('disconnected');
			return void 0;
		}

		return new Promise((resolve) => this._client.quit(() => {
			this._client = null;
			this.emit('disconnected');
			resolve();
		}));

	}

	_bindClientEvents () {

		[
			'ready',
			'connect',
			'reconnecting',
			'error',
			'end',
			'warning'
		].forEach((event) => this._client.on(event, (...args) => this.emit(event, ...args)));

		return this;

	}

	async connect ({host, port} = {}) {

		if (this._client && this._client.connected)
			return void 0;

		await this.disconnect();

		const options = {
			enable_offline_queue:false
		};

		if (host) {
			options.host = host;
			options.port = port || REDIS_PORT;
		}
		else if (this._peer.ipv4 && this._peer.ipv4.length)
			options.host = this._peer.ipv4[0];
		else if (this._peer.ipv6 && this._peer.ipv6.length)
			options.host = this._peer.ipv6[0];

		if (!options.port) {
			if (this._type === 'standalone')
				options.port = this._peer.redis_standalone_port;
			else if (this._type === 'node')
				options.port = this._peer.redis_node_port;
		}

		this._client = redis.createClient(options);
		this._bindClientEvents();
		this._commands = {};
		this._commandsProxy = new Proxy(
			this._commands,
			{
				get:(commands, command) => {

					if (!Reflect.has(commands, command))
						commands[command] = util.promisify(this._client[command]).bind(this._client);

					return commands[command];

				}
			}
		);

	}

}

module.exports = RedisNode;
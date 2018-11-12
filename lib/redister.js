'use strict';
const {IPV4} = require('./constants.js');
const {logger} = require('./logger.js');

const fs = require('fs');
const EventEmitter = require('events');
const os = require('os');

const penv = require('./penv.js');
const RedisCli = require('./redis-cli.js');
const RedisProcess = require('./redis-process.js');
const RedisNode = require('./redis-node.js');
const RedisCluster = require('./redis-cluster.js');
const Discovery = require('./discovery.js');

const routes = {
	me:require('../routes/me.js'),
	peers:require('../routes/peers.js'),
	default:require('../routes/default.js')
};

const {setClusterSize} = require('../apps/me.js');

class Redister extends EventEmitter {

	constructor (options = {}) {

		super();

		this._env = penv(null, options);
		this._setDefaults();

		process.on('SIGTERM', () => this.stop());

	}

	get cluster () {
		return this._cluster;
	}

	get discovery () {
		return this._discovery;
	}

	_setDefaults () {
		this._discovery = new Discovery(this._env);
		this._cluster = new RedisCluster(this._env);
		this._cluster.on('grownUp', () => {
			setClusterSize({
				cluster_size:this._cluster.nodes.size,
				propagate:true
			}, {
				env:this._env,
				discovery:this._discovery
			}).then(
				() => logger.info(`Cluster grown up to ${this._env.CLUSTER_SIZE} nodes`)
			).catch(
				(error) => logger.error(`Error while growing cluster: ${logger.stringifyError(error, true)}`)
			);
		});
		this._nodeNode = new RedisNode();
		this._nodeProcess = new RedisProcess();
		this._standaloneNode = new RedisNode();
		this._standaloneProcess = new RedisProcess();
		this._processInterval = null;
		this._isAofEnabled = false;
		this._needToMoveAof = false;
	}

	stop (_emit = true) {

		if (this._processInterval === null)
			return void 0;
		clearInterval(this._processInterval);
		this._discovery.stop();
		this._nodeNode.disconnect(true);
		this._nodeProcess.end();
		this._standaloneNode.disconnect(true);
		this._standaloneProcess.end();
		this._setDefaults();
		if (_emit)
			this.emit('end');
		return this;
	}

	_retrySetupNode () {
		setTimeout(() => this._setupNode(), parseInt(this._env.PROCESS_INTERVAL));
		return void 0;
	}

	async _enableAof (number, type) {
		const dataDirectory = `/data/${type}-${number}/`;
		this._ensureDirectory(dataDirectory);
		await this._nodeNode.commands.config('set', 'dir', dataDirectory);
		await this._nodeNode.commands.config('set', 'appendonly', 'yes');
	}

	async _restoreAofFile (number, type) {
		try {
			const aofDirectory = `/data/${type}-${number}/appendonly.aof`;
			fs.statSync(aofDirectory);
			await RedisCli.massInsert(aofDirectory);
		} catch (error) {
			if (error.code === 'ENOENT') {
				logger.warn('Nothing to restore from AOF');
				return void 0;
			}
			logger.error(`Error restoring AOF: ${logger.stringifyError(error)}`);
			return void 0;
		}
	}

	async _setupNode () {

		if (this._nodeNode.isConnected)
			return this._retrySetupNode();

		let nodeNumber = null;

		try {
			nodeNumber = await this._cluster.quorum.getNodeNumber();
		} catch (error) {
			logger.warn(`Error while getting node number: ${logger.stringifyError(error)}`);
			nodeNumber = null;
		}

		if (nodeNumber === null)
			return this._retrySetupNode();

		const hostname = os.hostname();

		const localIp = parseInt(this._env.NODE_DISCOVERY_FAMILY) === IPV4 ?
			this._discovery.peers.get(hostname).ipv4[0] :
			this._discovery.peers.get(hostname).ipv6[0];

		this._cluster.on('clusterized', async () => {
			if (this._isAofEnabled)
				return void 0;
			this._isAofEnabled = true;
			try {

				const masterNumber = await this._cluster.quorum.getNodeNumber('master');

				if (this._needToMoveAof && masterNumber === null) {
					this._isAofEnabled = false;
					return void 0;
				}

				if (masterNumber !== null) {
					await this._enableAof(masterNumber, 'master');
					if (this._needToMoveAof) {
						this._needToMoveAof = false;
						logger.info(`AOF file replaced for master ${masterNumber}`);
						return void 0;
					}
					await this._restoreAofFile(masterNumber, 'master');
					logger.info(`AOF file enabled for master ${masterNumber}`);
					return void 0;
				}
				this._isAofEnabled = false;
			} catch (error) {
				this._isAofEnabled = false;
				logger.warn(`Failed to enable AOF: ${logger.stringifyError(error)}`);
			}
		}).on('failover', async () => {
			this._needToMoveAof = true;
			this._isAofEnabled = false;
		});

		this._nodeProcess.setConfig(
			'port',
			this._env.REDIS_NODE_PORT
		).setConfig(
			'cluster-announce-ip',
			localIp
		).setConfig(
			'cluster-config-file',
			`nodes-${hostname}.conf`
		).setConfig(
			'bind',
			`${localIp} 127.0.0.1`
		).once(
			'start', () => logger.info('Redis node started')
		).once('ready', () => {
			this._nodeNode.on(
				'error', (error) => logger.error(`Node Redis error: ${logger.stringifyError(error, true)}`)
			).once('ready', () => {
				logger.info('Redis node process ready');
				this._cluster.setLocalNode(this._nodeNode);
			}).connect({
				host:'127.0.0.1',
				port:parseInt(this._env.REDIS_NODE_PORT)
			}).catch(
				(error) => logger.error(`Error in node Redis process: ${logger.stringifyError(error, true)}`)
			);
		}).once('end', () => this.stop()).start(this._env.NODE_CONFIG_PATH);

	}

	setup () {

		this.stop(false);
		this._processInterval = setInterval(async () => {

			this._cluster.ensure().then(
				(action) => logger[action === 'nothing_to_do' || action === 'aborted' ? 'trace' : 'info'](`Action for cluster: ${action}`)
			).catch(
				(error) => logger.error(`Error ensuring cluster: ${logger.stringifyError(error, true)}`)
			);

		}, parseInt(this._env.PROCESS_INTERVAL));
		return this;

	}

	start () {

		this._ensureDirectory('/tmp/redis_standalone')._prepare()._standaloneProcess.setConfig(
			'port',
			this._env.REDIS_STANDALONE_PORT
		).setConfig(
			'dir',
			'/tmp/redis_standalone/'
		).once(
			'start', () => logger.info('Redis standalone started')
		).once('ready', () => {
			this._standaloneNode.on(
				'error', (error) => logger.error(`Standalone Redis error: ${logger.stringifyError(error, true)}`)
			).once('ready', () => {
				logger.info('Redis standalone process ready');
				this._cluster.setStandaloneNode(this._standaloneNode).once('agreed', () => this._setupNode());
				this.emit('standalone.online');
			}).connect({
				host:'127.0.0.1',
				port:parseInt(this._env.REDIS_STANDALONE_PORT)
			}).catch(
				(error) => logger.error(`Error in standalone Redis process: ${logger.stringifyError(error, true)}`)
			);
		}).once('end', () => this.stop()).start(this._env.STANDALONE_CONFIG_PATH);
		return this;

	}

	_ensureDirectory (directory) {
		try {
			fs.mkdirSync(directory);
		} catch (error) {
			logger.warn(`Error ensuring directory (${directory}): ${logger.stringifyError(error)}`);
		}
		return this;
	}

	route (app) {

		routes.me(app, {
			env:this._env,
			cluster:this._cluster,
			nodeProcess:this._nodeProcess,
			discovery:this._discovery
		});
		routes.peers(app, {
			discovery:this._discovery
		});
		routes.default(app);
		return this;

	}

	_prepare () {

		this._discovery.on('added', (peerHostname) => {

			const peer = this._discovery.peers.get(peerHostname);
			const healthcheck = peer.healthcheck;

			healthcheck.on('offline', () => {
				if (healthcheck.attemptsAfterOffline >= parseInt(this._env.CUTOFF_HEALTHCHECK_ATTEMPTS)) {
					this._discovery.removePeer(peerHostname);
					logger.warn(`Peer ${peerHostname} removed due to cutoff healthcheck attempts`);
				}
			}).on(
				'error', (error) => logger.error(`Healthcheck error: ${logger.stringifyError(error)}`)
			).run(parseInt(this._env.NODE_HEALTHCHECK_INTERVAL));

			this._cluster.addNodeFromPeer(peer).then(
				(isNewNode) => isNewNode ? logger.info(`New peer node added ${peerHostname}`) : logger.trace(`Known node healthcheck ${peerHostname}`)
			).catch(
				(error) => logger.error(`Error while adding node to cluster ${logger.stringifyError(error)}`)
			);

		}).on(
			'error.discovery', (error) => logger.error(`Discovery error: ${logger.stringifyError(error)}`)
		).on(
			'removed', (hostname) => this._cluster.removeNodeFromPeer({hostname}, false)
		).run(
			parseInt(this._env.NODE_DISCOVERY_INTERVAL),
			parseInt(this._env.NODE_DISCOVERY_FAMILY),
			parseInt(this._env.NODE_DISCOVERY_RANDOM_DELAY)
		);
		return this;

	}

}

module.exports = Redister;
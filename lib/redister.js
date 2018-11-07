'use strict';
require('../defaults.js');
const {logger} = require('./logger.js');

const EventEmitter = require('events');
const os = require('os');

logger
	.setFormat(process.env.LOG_FORMAT)
	.setOutput(process.env.LOG_OUTPUT);

const penv = require('./penv.js');
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
		this._discovery = new Discovery(this._env);
		this._cluster = new RedisCluster(this._env);
		
		this._cluster.on('grownUp', () => {
			setClusterSize({
				cluster_size:this._cluster.nodes.size,
				propagate:true
			}).then(
				() => logger.info(`Cluster grown up to ${this._env.CLUSTER_SIZE} nodes`)
			).catch(
				(error) => logger.error(`Error while growing cluster: ${logger.stringifyError(error)}`)
			);
		});

		this._nodeNode = new RedisNode();
		this._nodeProcess = new RedisProcess();
		this._standaloneNode = new RedisNode();
		this._standaloneProcess = new RedisProcess();
		this._processInterval = null;

		process.on('SIGTERM', () => this.stop());

	}

	get cluster () {
		return this._cluster;
	}

	stop (_emit = true) {

		if (this._processInterval === null)
			return void 0;
		clearInterval(this._processInterval);
		this._processInterval = null;
		//this._app.server.close();
		this._discovery = new Discovery(this._env);
		this._cluster = new RedisCluster(this._env);
		this._nodeNode.disconnect(true);
		this._nodeNode = new RedisNode();
		this._nodeProcess.end();
		this._nodeProcess = new RedisProcess();;
		this._standaloneNode.disconnect(true);
		this._standaloneNode = new RedisNode();
		this._standaloneProcess.end();
		this._standaloneProcess = new RedisProcess();
		if (_emit)
			this.emit('end');
		return this;
	}

	async _setupNode () {
		
		if (this._nodeNode.isConnected)
			return void 0;

		let nodeNumber = null;

		try {
			nodeNumber = await this._cluster.quorum.getNodeNumber();
		} catch (error) {
			logger.warn(`Error while getting node number: ${logger.stringifyError(error)}`);
			nodeNumber = null;
		}

		if (nodeNumber === null)
			return void 0;

		const hostname = os.hostname();
		const localIp = parseInt(this._env.NODE_DISCOVERY_FAMILY) === 4 ?
						this._discovery.peers.get(hostname).ipv4[0] : 
						this._discovery.peers.get(hostname).ipv6[0];

		this._nodeProcess.setConfig(
			'port',
			this._env.REDIS_NODE_PORT
		).setConfig(
			'cluster-announce-ip',
			localIp
		).setConfig(
			'bind',
			`${localIp} 127.0.0.1`
		).setConfig(
			'appendfilename',
			`appendonly-${nodeNumber}.aof`
		).setConfig(
			'dbfilename',
			`redis-${nodeNumber}.rdb`
		).once(
			'start', () => logger.info('Redis node started')			
		).once('ready', () => {
			this._nodeNode.on(
				'error', (error) => logger.error(`Node Redis error: ${logger.stringifyError(error, true)}`)
			).connect({
				host:'127.0.0.1',
				port:parseInt(this._env.REDIS_NODE_PORT)
			}).then(() => {
				logger.info('Redis node process ready');
				this._cluster.setLocalNode(this._nodeNode);
			}).catch(
				(error) => logger.error(`Error in node Redis process: ${logger.stringifyError(error, true)}`)
			);
		}).once('end', () => this.stop()).start(this._env.NODE_CONFIG_PATH);

	}

	setupProcess () {

		this.stop(false);
		this._processInterval = setInterval(async () => {

			this._cluster.ensure().then(
				(action) => logger[action === 'nothing_to_do' ? 'trace' : 'info'](`Action for cluster: ${action}`)
			).catch(
				(error) => logger.error(`Error ensuring cluster: ${logger.stringifyError(error, true)}`)
			);

		}, parseInt(this._env.PROCESS_INTERVAL));

		return this;

	}

	setup () {

		this._standaloneProcess.setConfig(
			'port',
			this._env.REDIS_STANDALONE_PORT
		).once(
			'start', () => logger.info('Redis standalone started')
		).once('ready', () => {

			this._standaloneNode.on(
				'error', (error) => logger.error(`Standalone Redis error: ${logger.stringifyError(error, true)}`)
			).connect({
				host:'127.0.0.1',
				port:parseInt(this._env.REDIS_STANDALONE_PORT)
			}).then(() => {
				logger.info('Redis standalone process ready');
				this._cluster.setStandaloneNode(this._standaloneNode).once('agreed', () => this._setupNode());
				this.emit('standalone.online');
			}).catch(
				(error) => logger.error(`Error in standalone Redis process: ${logger.stringifyError(error, true)}`)
			);

		}).once('end', () => this.stop()).start(this._env.STANDALONE_CONFIG_PATH);

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

	start () {

		this._discovery.on('added', (peerHostname) => {

			const peer = this._discovery.peers.get(peerHostname);
			const healthcheck = peer.healthcheck;

			healthcheck.on('offline', () => {

				if (healthcheck.attemptsAfterOffline >= parseInt(this._env.CUTOFF_HEALTHCHECK_ATTEMPTS))
					this._discovery.removePeer(peerHostname);

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
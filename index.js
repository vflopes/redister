'use strict';
require('./defaults.js');
const polka = require('polka');
const send = require('@polka/send-type');
const RedisProcess = require('./lib/redis-process.js');
const RedisNode = require('./lib/redis-node.js');
const RedisCluster = require('./lib/redis-cluster.js');
const {json} = require('body-parser');
const {logger} = require('./lib/logger.js');
const {discovery} = require('./lib/discovery.js');
const os = require('os');
const routes = {
	me:require('./routes/me.js'),
	peers:require('./routes/peers.js'),
	default:require('./routes/default.js')
};

logger
	.setFormat(process.env.LOG_FORMAT)
	.setOutput(process.env.LOG_OUTPUT);

const vars = {
	processInterval:null,
	clearProcessInterval:() => {
		if (vars.processInterval === null)
			return void 0;
		clearInterval(vars.processInterval);
		vars.processInterval = null;
		vars.app.server.close();
		RedisNode.collection.node.disconnect(true);
		RedisProcess.collection.node.end();
		RedisNode.collection.standalone.disconnect(true);
		RedisProcess.collection.standalone.end();
	},
	setupProcess:() => {

		vars.clearProcessInterval();
		vars.processInterval = setInterval(async () => {

			RedisCluster.collection.cluster.ensure().then(
				(action) => logger[action === 'nothing_to_do' ? 'trace' : 'info'](`Action for cluster: ${action}`)
			).catch(
				(error) => logger.error(`Error ensuring cluster: ${logger.stringifyError(error, true)}`)
			);

		}, parseInt(process.env.PROCESS_INTERVAL));

	},
	setupStandalone:() => {
		RedisProcess.collection.standalone.setConfig(
			'port',
			process.env.REDIS_STANDALONE_PORT
		).once(
			'start', () => logger.info('Redis standalone started')
		).once('ready', () => {
			RedisNode.collection.standalone.on(
				'error', (error) => logger.error(`Standalone Redis error: ${logger.stringifyError(error, true)}`)
			).connect({
				host:'127.0.0.1',
				port:parseInt(process.env.REDIS_STANDALONE_PORT)
			}).then(() => {
				logger.info('Redis standalone process ready');
				RedisCluster.collection.cluster.setStandaloneNode(RedisNode.collection.standalone).once('agreed', () => vars.setupNode());
				vars.app.listen(
					parseInt(process.env.HTTP_SERVER_PORT),
					() => {
						logger.info(`HTTP server listening`);
						vars.setupProcess();
					}
				);
			}).catch(
				(error) => logger.error(`Error in standalone Redis process: ${logger.stringifyError(error, true)}`)
			);
		}).once('end', () => vars.clearProcessInterval()).start('/usr/local/etc/redis/redis-standalone.conf');
	},
	setupNode:() => {
		
		if (RedisNode.collection.node.isConnected)
			return void 0;

		RedisProcess.collection.node.setConfig(
			'port',
			process.env.REDIS_NODE_PORT
		).setConfig(
			'cluster-announce-ip',
			discovery.peers.get(os.hostname()).ipv4[0]
		).setConfig(
			'bind',
			`${discovery.peers.get(os.hostname()).ipv4[0]} 127.0.0.1`
		).once(
			'start', () => logger.info('Redis node started')			
		).once('ready', () => {
			RedisNode.collection.node.on(
				'error', (error) => logger.error(`Node Redis error: ${logger.stringifyError(error, true)}`)
			).connect({
				host:'127.0.0.1',
				port:parseInt(process.env.REDIS_NODE_PORT)
			}).then(() => {
				logger.info('Redis node process ready');
				RedisCluster.collection.cluster.setLocalNode(RedisNode.collection.node);
			}).catch(
				(error) => logger.error(`Error in node Redis process: ${logger.stringifyError(error, true)}`)
			);
		}).once('end', () => vars.clearProcessInterval()).start('/usr/local/etc/redis/redis-node.conf');
	},
	setup:() => vars.setupStandalone()
};

discovery.on('added', (peerHostname) => {

	const peer = discovery.peers.get(peerHostname);
	const healthcheck = peer.healthcheck;

	healthcheck.on('offline', () => {

		if (healthcheck.attemptsAfterOffline >= parseInt(process.env.CUTOFF_HEALTHCHECK_ATTEMPTS))
			discovery.removePeer(peerHostname);

	}).on(
		'error',
		(error) => logger.error(`Healthcheck error: ${logger.stringifyError(error)}`)
	).run(
		parseInt(process.env.NODE_HEALTHCHECK_INTERVAL)
	);

	RedisCluster.collection.cluster.addNodeFromPeer(peer).then(
		(isNewNode) => isNewNode ? logger.info(`New peer node added ${peerHostname}`) : logger.trace(`Known node healthcheck ${peerHostname}`)
	).catch(
		(error) => logger.error(`Error while adding node to cluster ${logger.stringifyError(error)}`)
	);

}).on(
	'error.discovery',
	(error) => logger.error(`Discovery error: ${logger.stringifyError(error)}`)
).on(
	'removed',
	(hostname) => RedisCluster.collection.cluster.removeNodeFromPeer({hostname}, false)
).run(
	parseInt(process.env.NODE_DISCOVERY_INTERVAL),
	parseInt(process.env.NODE_DISCOVERY_FAMILY)
);

vars.app = polka().use(json());

routes.me(vars.app);
routes.peers(vars.app, {discovery});
routes.default(vars.app);

vars.setup();
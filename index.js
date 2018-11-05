'use strict';
require('dotenv').config();
const polka = require('polka');
const send = require('@polka/send-type');
const RedisProcess = require('./lib/redis-process.js');
const {json} = require('body-parser');
const {logger} = require('./lib/logger.js');
const {discovery} = require('./lib/discovery.js');
const {cluster} = require('./lib/redis-cluster.js');
const {localRedis} = require('./lib/redis-node.js');

const vars = {
	nodeNumber:null,
	processInterval:null,
	hasWitnessServer:false,
	isWitnessServer:process.env.IS_WITNESS_SERVER === 'true',
	clearProcessInterval:() => {
		if (vars.processInterval === null)
			return void 0;
		clearInterval(vars.processInterval);
		vars.processInterval = null;
	},
	setupProcess:() => {

		vars.processInterval = setInterval(async () => {

			if (vars.isWitnessServer)
				return void 0;

			cluster.ensure().then(
				(action) => logger.info(`Action for cluster: ${action}`)
			).catch(
				(error) => logger.error(`Error ensuring cluster: ${logger.stringifyError(error, true)}`)
			);

		}, parseInt(process.env.PROCESS_INTERVAL || 500));

		redis.once('start', () =>
			app.listen(
				parseInt(process.env.HTTP_SERVER_PORT || 80),
				() => logger.info(`HTTP server listening`)
			)
		).once('ready', () =>
			localRedis.connect({host:'127.0.0.1'}).then(
				() => logger.info('Local Redis process ready')
			).catch(
				(error) => logger.error(`Error in local Redis process: ${logger.stringifyError(error, true)}`)
			)
		).once('end', () => {
			vars.clearProcessInterval();
			app.server.close();
		}).start();

	}
};
const redis = new RedisProcess();
const routes = {
	me:require('./routes/me.js'),
	peers:require('./routes/peers.js'),
	default:require('./routes/default.js')
};

logger
	.setFormat(process.env.LOG_FORMAT || 'pretty')
	.setOutput(process.env.LOG_OUTPUT || 'stdout');

discovery.on('added', (peerHostname) => {

	const peer = discovery.peers.get(peerHostname);
	const healthcheck = peer.healthcheck;

	healthcheck.on('offline', () => {

		if (healthcheck.attemptsAfterOffline >= parseInt(process.env.CUTOFF_HEALTHCHECK_ATTEMPTS || 10))
			discovery.removePeer(peerHostname);

	}).on(
		'error',
		(error) => logger.error(`Healthcheck error: ${logger.stringifyError(error)}`)
	).run(
		parseInt(process.env.NODE_HEALTHCHECK_INTERVAL || 100)
	);

	if (vars.isWitnessServer)
		return void 0;

	if (peer.is_witness_server) {

		if (cluster.witnessServer && cluster.witnessServer.hostname === peerHostname) {
			logger.trace(`Witness server already connected`);
			return void 0;
		}

		cluster.connectWitnessServer(peer).then(() => {
			logger.info(`Witness server connected, hostname ${peerHostname}`);
		}).catch(
			(error) => logger.error(`Couldn't connect to witness server: ${logger.stringifyError(error)}`)
		);
		return void 0;
	}

	cluster.addNodeFromPeer(peer).then((isNewNode) => {
		if (isNewNode)
			logger.info(`New peer node added ${peerHostname}`);
	}).catch(
		(error) => logger.error(`Error while adding node to cluster ${logger.stringifyError(error)}`)
	);

}).on(
	'error.discovery',
	(error) => logger.trace(`Discovery error: ${logger.stringifyError(error)}`)
).run(
	parseInt(process.env.NODE_DISCOVERY_INTERVAL || 100),
	parseInt(process.env.NODE_DISCOVERY_FAMILY || 4)
);

const app = polka().use(json());

routes.me(app);
routes.peers(app, {discovery});
routes.default(app);
'use strict';
require('dotenv').config();
const polka = require('polka');
const send = require('@polka/send-type');
const {json} = require('body-parser');
const {STATUS_CODES} = require('http');
const HTTP_SERVER_PORT = parseInt(process.env.HTTP_SERVER_PORT || 80);
const {logger} = require('./lib/logger.js');

switch (process.env.LOG_FORMAT) {
	case 'pretty':
		logger.on('log', (logEntry) => console.log(`${logEntry.timestamp}\t[${logEntry.address}|${logEntry.trackerId}]\t[${logEntry.level.toUpperCase()}]\t${logEntry.message}`));
		break;
	default:
		logger.on('log', (logEntry) => console.log(JSON.stringify(logEntry)));
		break;
}

const Discovery = require('./lib/discovery.js');
const discovery = new Discovery(process.env.NODE_DISCOVERY_HOSTNAME, HTTP_SERVER_PORT);
discovery.on('added', (peerHostname) => {
	discovery.peers.get(peerHostname).healthcheck.run(parseInt(process.env.NODE_HEALTHCHECK_INTERVAL || 100));
}).on(
	'error',
	(error) => logger.error(`Discovery error: ${logger.stringifyError(error)}`)
).run(parseInt(process.env.NODE_DISCOVERY_INTERVAL || 100));

const routes = {
	me:require('./routes/me.js')
};

const app = polka().use(json());

routes.me(app);

app.all('*', (request, response) => send(response, 404, {
	errors:[
		{
			status:'404',
			title:STATUS_CODES[404].toLowerCase()
		}
	]
}));

app.listen(HTTP_SERVER_PORT);

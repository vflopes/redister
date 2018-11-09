'use strict';
const polka = require('polka');
const path = require('path');
const {json} = require('body-parser');
const Redister = require('./lib/redister.js');
const penv = require('./lib/penv.js');
const {logger} = require('./lib/logger.js');

if (path.dirname(require.main.filename) === __dirname) {

	require('./defaults.js');
	process.setMaxListeners(0);
	const env = penv();
	logger
		.setFormat(env.LOG_FORMAT)
		.setOutput(env.LOG_OUTPUT)
		.setMinimumLevel(env.LOG_LEVEL);
	const redister = new Redister();
	const app = polka().use(json());
	redister.on('standalone.online', () => {
		app.listen(
			parseInt(env.HTTP_SERVER_PORT),
			() => {
				logger.info('HTTP server listening');
				redister.setup();
			}
		);
	}).on(
		'end', () => app.server.close()
	).route(app).start();

}

module.exports = Redister;
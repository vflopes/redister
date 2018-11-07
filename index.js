'use strict';
const polka = require('polka');
const {json} = require('body-parser');
const Redister = require('./lib/redister.js');
const penv = require('./lib/penv.js');
const {logger} = require('./lib/logger.js');

if (process.argv.includes('--run-redister')) {

	const redister = new Redister();
	const app = polka().use(json());
	const env = penv();
	redister.on('standalone.online', () => {
		app.listen(
			parseInt(env.HTTP_SERVER_PORT),
			() => {
				logger.info(`HTTP server listening`);
				redister.setupProcess();
			}
		);
	}).on(
		'end', () => app.server.close()
	).route(app).start().setup();

}

module.exports = Redister;
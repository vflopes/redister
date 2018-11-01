'use strict';
const {getInformation} = require('../apps/me.js');
const send = require('@polka/send-type');

module.exports = (app) => {
	app
		.get('/me', (request, response) => send(response, 200, {data:getInformation()}))

	return app;
};
'use strict';
const {getNotFoundError} = require('../apps/default.js');
const send = require('@polka/send-type');

module.exports = (app) => {
	app
		.get('/*', (request, response) => send(response, 404, {errors:[getNotFoundError()]}))

	return app;
};
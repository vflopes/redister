'use strict';
const {getNotFoundError} = require('../apps/default.js');
const send = require('@polka/send-type');
const {HTTP_NOT_FOUND} = require('../lib/constants.js');

module.exports = (app) => {
	app
		.get('/*', (request, response) => send(response, HTTP_NOT_FOUND, {errors:[getNotFoundError()]}));

	return app;
};
'use strict';
const {getPeersInformationFromDiscovery} = require('../apps/peers.js');
const send = require('@polka/send-type');
const {HTTP_OK} = require('../lib/constants.js');

module.exports = (app, {discovery}) => {
	app
		.get('/peers', (request, response) => send(response, HTTP_OK, {data:getPeersInformationFromDiscovery({discovery})}));

	return app;
};
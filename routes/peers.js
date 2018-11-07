'use strict';
const {getPeersInformationFromDiscovery} = require('../apps/peers.js');
const send = require('@polka/send-type');

module.exports = (app, {discovery}) => {
	app
		.get('/peers', (request, response) => send(response, 200, {data:getPeersInformationFromDiscovery({discovery})}))

	return app;
};
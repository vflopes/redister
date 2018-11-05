'use strict';

const getPeersInformationFromDiscovery = (discovery) => {
	const information = [];
	for (const [hostname, peer] of discovery.peers) {
		const peerInformation = Object.assign({}, peer);
		delete peerInformation.healthcheck;
		delete peerInformation.redis;
		information.push(peerInformation);
	}
	return information;
};

module.exports = {
	getPeersInformationFromDiscovery
};
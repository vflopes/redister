'use strict';
const os = require('os');
const dns = require('dns');
const {cluster} = require('../lib/redis-cluster.js');

const getNetworkInterfaces = () => {
	
	const networkInterfaces = os.networkInterfaces();
	const networkInterfacesNames = Object.keys(networkInterfaces);
	const parsedNetworkInterfaces = [];

	for (const networkInterfacesName of networkInterfacesNames) {
		for (const networkInterface of networkInterfaces[networkInterfacesName]) {
			parsedNetworkInterfaces.push(Object.assign({
				name:networkInterfacesName
			}, networkInterface));
		}
	}

	return parsedNetworkInterfaces;

};

const getInformation = () => {
	return {
		cluster_namespace:process.env.CLUSTER_NAMESPACE,
		hostname:os.hostname(),
		system_uptime:os.uptime(),
		is_leader:cluster.quorum.isLeader,
		is_witness_server:process.env.IS_WITNESS_SERVER === 'true',
		system_timestamp:Date.now(),
		load_average:os.loadavg(),
		free_memory:os.freemem(),
		total_memory:os.totalmem(),
		dns_servers:dns.getServers(),
		redis_port:parseInt(process.env.REDIS_PORT || 6379),
		network_interfaces:getNetworkInterfaces()
	};
};

module.exports = {
	getInformation,
	getNetworkInterfaces
};
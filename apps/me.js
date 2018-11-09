'use strict';
const os = require('os');
const dns = require('dns');
const request = require('request-promise-native');

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

const getInformation = async ({env, cluster, nodeProcess}) => {
	return {
		cluster_namespace:env.CLUSTER_NAMESPACE,
		hostname:os.hostname(),
		integer_stamp:cluster.integerStamp,
		system_uptime:os.uptime(),
		is_leader:cluster.quorum.isLeader,
		node_number:await cluster.quorum.getNodeNumber(),
		leader_hostname:await cluster.quorum.getLeaderHostname(),
		system_timestamp:Date.now(),
		load_average:os.loadavg(),
		free_memory:os.freemem(),
		total_memory:os.totalmem(),
		dns_servers:dns.getServers(),
		redis_node_status:nodeProcess.status,
		redis_node_port:parseInt(env.REDIS_NODE_PORT),
		redis_standalone_port:parseInt(env.REDIS_STANDALONE_PORT),
		cluster_creation_timestamp:await cluster.getClusterCreationTimestamp(),
		cluster_size:parseInt(env.CLUSTER_SIZE),
		cluster_information:await cluster.getClusterInformation(),
		cluster_nodes:await cluster.getClusterNodes(),
		network_interfaces:getNetworkInterfaces(),
		peers:Array.from(cluster.nodes.keys())
	};
};

const setClusterSize = async (options = {}, {env, discovery}) => {

	env.CLUSTER_SIZE = parseInt(options.cluster_size || env.CLUSTER_SIZE);

	if (options.propagate)
		await Promise.all(Array.from(discovery.peers.values()).map(async (peer) => {

			if (peer.hostname === os.hostname())
				return true;

			await request({
				method:'POST',
				uri:`http://${peer.hostname}:${peer.http_port}/cluster/size`,
				body:{
					cluster_size:env.CLUSTER_SIZE,
					propagate:false
				},
				json:true
			});

		}));

	return options;

};

module.exports = {
	getInformation,
	getNetworkInterfaces,
	setClusterSize
};
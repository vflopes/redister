'use strict';
const os = require('os');
const dns = require('dns');
const request = require('request-promise-native');
const RedisCluster = require('../lib/redis-cluster.js');
const {discovery} = require('../lib/discovery.js');
const {logger} = require('../lib/logger.js');

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

const getInformation = async () => {
	return {
		cluster_namespace:process.env.CLUSTER_NAMESPACE,
		hostname:os.hostname(),
		system_uptime:os.uptime(),
		is_leader:RedisCluster.collection.cluster.quorum.isLeader,
		leader_hostname:await RedisCluster.collection.cluster.quorum.getLeaderHostname(),
		system_timestamp:Date.now(),
		load_average:os.loadavg(),
		free_memory:os.freemem(),
		total_memory:os.totalmem(),
		dns_servers:dns.getServers(),
		redis_node_port:parseInt(process.env.REDIS_NODE_PORT),
		redis_standalone_port:parseInt(process.env.REDIS_STANDALONE_PORT),
		cluster_size:parseInt(process.env.CLUSTER_SIZE),
		network_interfaces:getNetworkInterfaces(),
		peers:Array.from(RedisCluster.collection.cluster.nodes.keys())
	};
};

const setClusterSize = async (options = {}) => {

	process.env.CLUSTER_SIZE = parseInt(options.cluster_size || process.env.CLUSTER_SIZE);

	if (options.propagate)
		await Promise.all(Array.from(discovery.peers.values()).map(async (peer) => {

			if (peer.hostname === os.hostname())
				return true;

			await request({
				method:'POST',
				uri:`http://${peer.hostname}:${peer.http_port}/cluster/size`,
				body:{
					cluster_size:process.env.CLUSTER_SIZE,
					propagate:false
				},
				json:true
			});

		}));

	return options;

};

RedisCluster.collection.cluster.on('grownUp', () => {

	setClusterSize({
		cluster_size:RedisCluster.collection.cluster.nodes.size,
		propagate:true
	}).then(
		() => logger.info(`Cluster grown up to ${process.env.CLUSTER_SIZE} nodes`)
	).catch(
		(error) => logger.error(`Error while growing cluster: ${logger.stringifyError(error)}`)
	);

});

module.exports = {
	getInformation,
	getNetworkInterfaces,
	setClusterSize
};
'module.exports';
const request = require('request-promise-native');
const sleep = require('../lib/sleep.js');
const chalk = require('chalk');

/**
 * How to know if a cluster is ready using redister?
 * You'll need the response of the /peers route
 * Check if:
 * - The number of peers is the number of nodes you're expecting
 * - One and only one peer has the field "is_leader" equal to true
 * - All peers have the field "redis_node_status" equal to "ready"
 * - The path "cluster_information.cluster_state" is "ok"
 * - The path "cluster_information.cluster_known_nodes" is the string representation of the number of node you're expecting in the cluster
 */

module.exports = async (expectedMasters = 3, expectedSlaves = 3) => {
	
	const start = Date.now();
	console.log(chalk.cyanBright.bold('Waiting the cluster enter in ready state'));

	let isClusterReady = false;
	while (!isClusterReady) {
		await sleep();
		try {
			const response = await request({uri:`http://localhost:44195/peers`, json:true});
			if (
				response.data.length === expectedMasters+expectedSlaves
				&& response.data.filter((peer) => peer.is_leader).length === 1
				&& response.data.filter((peer) => peer.redis_node_status === 'ready').length === expectedMasters+expectedSlaves
				&& response.data.filter((peer) => peer.cluster_nodes && peer.cluster_nodes.filter((clusterNode) => clusterNode.node_state.includes('myself,master')).length === 1).length === expectedMasters
				&& response.data.filter((peer) => peer.cluster_nodes && peer.cluster_nodes.filter((clusterNode) => clusterNode.node_state.includes('myself,slave')).length === 1).length === expectedSlaves
				&& response.data.filter((peer) => peer.cluster_information && peer.cluster_information.cluster_state === 'ok').length === expectedMasters+expectedSlaves
				&& response.data.filter((peer) => peer.cluster_information && parseInt(peer.cluster_information.cluster_known_nodes) === expectedMasters+expectedSlaves).length === expectedMasters+expectedSlaves
			)
				isClusterReady = true;
			console.log(chalk.yellowBright.bold('Cluster is not ready'));
		} catch (error) {
			console.log(`Waiting for cluster to be responsive (${error.message})...`);
		}
	}

	console.log(chalk.greenBright.bold(`Cluster stabilized in ${Date.now()-start}ms`));

};
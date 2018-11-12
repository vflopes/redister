'use strict';
const setupCluster = require('./setup-cluster.js');
const destroyCluster = require('./destroy-cluster.js');
const waitClusterReady = require('./wait-cluster-ready.js');
const request = require('request-promise-native');
const util = require('util');
const exec = util.promisify(require('child_process').exec);
const chalk = require('chalk');
const path = require('path');

const masterDown = async () => {

	await setupCluster();
	await waitClusterReady();

	const response = await request({uri:`http://localhost:44195/peers`, json:true});

	const [master1, master2, master3] = response.data.filter((peer) => peer.cluster_nodes.filter((clusterNode) => clusterNode.node_state.includes('myself,master')).length === 1);

	console.log(`The containers ${master1.hostname} and ${master2.hostname} will be stopped`);
	await exec(`docker stop ${master1.hostname} ${master2.hostname}`);
	console.log(`The containers ${master1.hostname} and ${master2.hostname} will be removed`);
	await exec(`docker rm ${master1.hostname} ${master2.hostname}`);
	await waitClusterReady();
	console.log(`The container ${master3.hostname} will be stopped`);
	await exec(`docker stop ${master3.hostname}`);
	console.log(`The container ${master3.hostname} will be removed`);
	await exec(`docker rm ${master3.hostname}`);
	await waitClusterReady();
	await destroyCluster();

};

if (path.dirname(require.main.filename) === __dirname) {
	masterDown().then(
		() => console.log(chalk.greenBright.bold('Master down test passed'))
	).catch(
		(error) => console.log(chalk.redBright.bold('Master down test failed: ')+error.message)
	);
}

module.exports = masterDown;
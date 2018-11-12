'use strict';
const setupCluster = require('./setup-cluster.js');
const destroyCluster = require('./destroy-cluster.js');
const waitClusterReady = require('./wait-cluster-ready.js');
const request = require('request-promise-native');
const util = require('util');
const exec = util.promisify(require('child_process').exec);
const chalk = require('chalk');
const path = require('path');

const slaveDown = async () => {

	await setupCluster();
	await waitClusterReady();

	const response = await request({uri:`http://localhost:44195/peers`, json:true});

	const [slave1, slave2, slave3] = response.data.filter((peer) => peer.cluster_nodes.filter((clusterNode) => clusterNode.node_state.includes('myself,slave')).length === 1);

	console.log(`The containers ${slave1.hostname} and ${slave2.hostname} will be stopped`);
	await exec(`docker stop ${slave1.hostname} ${slave2.hostname}`);
	console.log(`The containers ${slave1.hostname} and ${slave2.hostname} will be removed`);
	await exec(`docker rm ${slave1.hostname} ${slave2.hostname}`);
	await waitClusterReady();
	console.log(`The container ${slave3.hostname} will be stopped`);
	await exec(`docker stop ${slave3.hostname}`);
	console.log(`The container ${slave3.hostname} will be removed`);
	await exec(`docker rm ${slave3.hostname}`);
	await waitClusterReady();
	await destroyCluster();

};

if (path.dirname(require.main.filename) === __dirname) {
	slaveDown().then(
		() => console.log(chalk.greenBright.bold('Slave down test passed'))
	).catch(
		(error) => console.log(chalk.redBright.bold('Slave down test failed: ')+error.message)
	);
}

module.exports = slaveDown;
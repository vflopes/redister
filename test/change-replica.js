'use strict';
const setupCluster = require('./setup-cluster.js');
const destroyCluster = require('./destroy-cluster.js');
const waitClusterReady = require('./wait-cluster-ready.js');
const {checkKeys,populateKeys} = require('./check-keys.js');
const request = require('request-promise-native');
const util = require('util');
const exec = util.promisify(require('child_process').exec);
const chalk = require('chalk');
const path = require('path');

const changeReplica = async () => {

	await setupCluster();
	await waitClusterReady();

	console.log(`The cluster replicas will be changed from 1 to 2`);

	await request({
		method:'POST',
		uri:`http://localhost:44195/cluster/size`,
		body:{
			cluster_replicas:2
		},
		json:true
	});
	
	console.log('Setting keys');
	await populateKeys(10);
	console.log(`The cluster will be scaled to 7 containers`);
	await exec(`docker service scale redis_redis=7`);
	console.log(`Expecting 3 masters and 4 slaves`);
	await waitClusterReady(3, 4);
	console.log('Checking keys');
	await checkKeys(10);
	console.log(`The cluster will be scaled to 8 containers`);
	await exec(`docker service scale redis_redis=8`);
	console.log(`Expecting 3 masters and 5 slaves`);
	await waitClusterReady(3, 5);
	console.log('Checking keys');
	await checkKeys(10);
	console.log(`The cluster will be scaled to 10 containers`);
	await exec(`docker service scale redis_redis=10`);
	console.log(`Expecting 4 masters and 6 slaves`);
	await waitClusterReady(4, 6);
	console.log('Checking keys');
	await checkKeys(10);
	await destroyCluster();

};

if (path.dirname(require.main.filename) === __dirname) {
	changeReplica().then(
		() => console.log(chalk.greenBright.bold('Change replica test passed'))
	).catch(
		(error) => console.log(chalk.redBright.bold('Change replica test failed: ')+error.message)
	);
}

module.exports = changeReplica;
'use strict';
const setupCluster = require('./setup-cluster.js');
const destroyCluster = require('./destroy-cluster.js');
const {checkKeys,populateKeys} = require('./check-keys.js');
const execRedisCli = require('./exec-redis-cli.js');
const util = require('util');
const exec = util.promisify(require('child_process').exec);
const chalk = require('chalk');
const path = require('path');

const scaleUp = async () => {

	await setupCluster();
	await waitClusterReady();
	console.log('Setting keys');
	await populateKeys(10);
	console.log(`The cluster will be scaled to 7 containers`);
	await exec(`docker service scale redis_redis=7`);
	console.log(`Expecting 4 masters and 3 slaves`);
	await waitClusterReady(4, 3);
	console.log('Checking keys');
	await checkKeys(10);
	console.log(`The cluster will be scaled to 8 containers`);
	await exec(`docker service scale redis_redis=8`);
	console.log(`Expecting 4 masters and 4 slaves`);
	await waitClusterReady(4, 4);
	console.log('Checking keys');
	await checkKeys(10);
	await destroyCluster();

};

if (path.dirname(require.main.filename) === __dirname) {
	scaleUp().then(
		() => console.log(chalk.greenBright.bold('Scale up test passed'))
	).catch(
		(error) => console.log(chalk.redBright.bold('Scale up test failed: ')+error.message)
	);
}

module.exports = scaleUp;
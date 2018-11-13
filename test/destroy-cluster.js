'use strict';
const util = require('util');
const exec = util.promisify(require('child_process').exec);
const path = require('path');
const chalk = require('chalk');

const baseDirectory = path.resolve(__dirname, '..');

module.exports = async () => {
		
	console.log(chalk.cyanBright.bold('Destroying the cluster'));
	await exec(`docker stack rm redis`);
	let removedService = false;
	while (!removedService) {
		const {stdout} = await exec(`docker service ls --filter label=com.docker.stack.namespace=redis -q`);
		if (stdout.toString('utf8').replace(/[\s\n]+/g, '').length === 0)
			removedService = true;
	}
	let removedNetwork = false;
	while (!removedNetwork) {
		const {stdout} = await exec(`docker network ls --filter label=com.docker.stack.namespace=redis -q`);
		if (stdout.toString('utf8').replace(/[\s\n]+/g, '').length === 0)
			removedNetwork = true;
	}
	console.log(chalk.greenBright.bold('Cluster destroyed'));

};
'module.exports';
const util = require('util');
const exec = util.promisify(require('child_process').exec);
const path = require('path');
const chalk = require('chalk');

const baseDirectory = path.resolve(__dirname, '..');

module.exports = async () => {
		
	console.log(chalk.cyanBright.bold('Destroying the cluster'));
	await exec(`docker stack rm redis`);
	console.log(chalk.greenBright.bold('Cluster destroyed'));

};
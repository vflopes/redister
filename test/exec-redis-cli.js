'use strict';
const util = require('util');
const exec = util.promisify(require('child_process').exec);
const path = require('path');
const chalk = require('chalk');

const baseDirectory = path.resolve(__dirname, '..');

module.exports = async (command) => {

	console.log(chalk.cyanBright.bold('Executing command: ')+command);
	const {stdout} = await exec(`docker ps --format "{{.ID}}" -f label=com.docker.stack.namespace=redis -f name=redis_redis_cli`);
	const id = stdout.toString('utf8').replace(/[\s\r\n]+/g, '');
	const output = await exec(`docker exec ${id} redis-cli -c -h redis ${command}`);
	console.log(chalk.greenBright.bold('Command executed: ')+command);
	return {
		stdout:output.stdout.toString('utf8').replace(/[\s\r\n]+/g, ''),
		stderr:output.stderr.toString('utf8').replace(/[\s\r\n]+/g, '')
	};

};

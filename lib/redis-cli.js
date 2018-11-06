'use strict';
const {logger} = require('./logger.js');
const util = require('util');
const exec = util.promisify(require('child_process').exec);

class RedisCli {

	static async createCluster (nodes) {

		let command = ['echo yes | redis-cli --cluster create'];

		for (const node of nodes) {
			const ip = parseInt(process.env.NODE_DISCOVERY_FAMILY) === 4 ? node.ipv4[0] : node.ipv6[0];
			command.push(`${ip}:${node.redis_node_port}`);
		}

		command.push(`--cluster-replicas ${process.env.CLUSTER_REPLICAS}`);
		command = command.join(' ');
		logger.info(`Preparing to execute: ${command}`);

		//const {stdout,stderr} = await exec(command);
		//logger.info(`(${command}) stdout: ${stdout}`);
		//logger.info(`(${command}) stderr: ${stderr}`);
		//return {stdout,stderr};

	}

}

module.exports = RedisCli;
'use strict';
const {logger} = require('./logger.js');
const util = require('util');
const exec = util.promisify(require('child_process').exec);

class RedisCli {

	static async createCluster (nodes, env) {

		let command = ['echo yes | redis-cli --cluster create'];

		for (const node of nodes) {
			const ip = parseInt(env.NODE_DISCOVERY_FAMILY) === 4 ? node.ipv4[0] : node.ipv6[0];
			command.push(`${ip}:${node.redis_node_port}`);
		}

		command.push(`--cluster-replicas ${env.CLUSTER_REPLICAS}`);
		command = command.join(' ');
		logger.info(`Preparing to execute: ${command}`);

		const {stdout,stderr} = await exec(command);
		logger.info(`(${command}) stdout: ${stdout}`);
		logger.info(`(${command}) stderr: ${stderr}`);
		return {stdout,stderr};

	}

	static async addNode (newNode, clusterNode, env, masterNodeId = null) {

		let command = ['echo yes | redis-cli --cluster add-node'];
		
		const newNodeIp = parseInt(env.NODE_DISCOVERY_FAMILY) === 4 ? newNode.ipv4[0] : newNode.ipv6[0];
		command.push(`${newNodeIp}:${newNode.redis_node_port}`);

		const clusterNodeIp = parseInt(env.NODE_DISCOVERY_FAMILY) === 4 ? clusterNode.ipv4[0] : clusterNode.ipv6[0];
		command.push(`${clusterNodeIp}:${clusterNode.redis_node_port}`);

		if (masterNodeId)
			command.push(`--cluster-slave --cluster-master-id ${masterNodeId}`);

		command = command.join(' ');
		logger.info(`Preparing to execute: ${command}`);

		const {stdout,stderr} = await exec(command);
		logger.info(`(${command}) stdout: ${stdout}`);
		logger.info(`(${command}) stderr: ${stderr}`);
		return {stdout,stderr};

	}


}

module.exports = RedisCli;
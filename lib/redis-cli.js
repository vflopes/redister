'use strict';
const {IPV4} = require('./constants.js');
const {logger} = require('./logger.js');
const util = require('util');
const child_process = require('child_process');
const exec = util.promisify(child_process.exec);
const spawn = child_process.spawn;
const os = require('os');
const shortid = require('shortid');
const STRING_MAX_SIZE = 51200;
const maxBuffer = 10485760;
const fs = require('fs');
const AofDecoder = require('./aof-decoder.js');

const truncateString = (string, length) => string.length <= length ? string : string.substring(0, length)+'[...]';
const joinString = (string) => string.replace(/\r/g, '').split('\n').join('|');
const stringifyStdBuffers = ({stdout, stderr}) => {
	return {
		stdout:truncateString(joinString(stdout.toString('utf8')), STRING_MAX_SIZE),
		stderr:joinString(stderr.toString('utf8'))
	};
};
const getAddressFromNode = (env, node) => {
	const family = parseInt(env.NODE_DISCOVERY_FAMILY);
	if (family === IPV4)
		return `${node.ipv4[0]}:${node.redis_node_port}`;
	return node.ipv6[0];
};

class RedisCli {

	static async createCluster (nodes, env) {

		const command = ['echo yes | redis-cli --cluster create'];

		for (const node of nodes)
			command.push(getAddressFromNode(env, node));

		command.push(`--cluster-replicas ${env.CLUSTER_REPLICAS}`);

		return await RedisCli._exec(command);

	}

	static async addNode (newNode, clusterNode, env, masterNodeId = null) {

		const command = [`echo yes | redis-cli --cluster add-node ${getAddressFromNode(env, newNode)} ${getAddressFromNode(env, clusterNode)}`];

		if (masterNodeId)
			command.push(`--cluster-slave --cluster-master-id ${masterNodeId}`);

		return await RedisCli._exec(command);

	}

	static async reshard (referenceNode, targetNodeId, numberOfSlots, env) {
		return await RedisCli._exec(`redis-cli --cluster reshard ${getAddressFromNode(env, referenceNode)} --cluster-from all --cluster-to ${targetNodeId} --cluster-slots ${numberOfSlots} --cluster-yes`);
	}

	static async massInsert (sourceAof) {
		const source = {address:os.hostname(), trackerId:`cmd-${shortid.generate()}`};
		const redisCli = spawn('redis-cli', ['-c']);
		logger.info(source, 'redis-cli started');
		const aof = new AofDecoder();
		aof.on('command', (command) => redisCli.stdin.write(command+'\n'));
		redisCli.stdout.on('data', (data) => logger.info(source, `stdout: ${joinString(data.toString('utf8'))}`));
		redisCli.stderr.on('data', (data) => logger.info(source, `stderr: ${joinString(data.toString('utf8'))}`));
		redisCli.on('close', () => logger.info(source, 'redis-cli finished'));
		fs.createReadStream(sourceAof).pipe(aof);
	}

	static async _exec (command) {

		const source = {address:os.hostname(), trackerId:`cmd-${shortid.generate()}`};
		command = Array.isArray(command) ? command.join(' ') : command;
		logger.info(source, `Preparing to execute: ${command}`);
		const {stdout, stderr} = stringifyStdBuffers(await exec(command, {maxBuffer}));
		logger.info(source, `stdout: ${stdout}`);
		logger.info(source, `stderr: ${stderr}`);
		return {stdout, stderr};

	}

}

module.exports = RedisCli;
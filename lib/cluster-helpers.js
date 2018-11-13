'use strict';

class ClusterHelpers {

	static findMyself (clusterNodes) {
		return clusterNodes.find((clusterNode) => clusterNode.node_state.includes('myself'));
	}

	static isSlave (clusterNode) {
		return clusterNode.node_state.includes('slave');
	}

	static isMaster (clusterNode) {
		return clusterNode.node_state.includes('master');
	}

	static isMyself (clusterNode) {
		return clusterNode.node_state.includes('myself');
	}

	static isPFail (clusterNode) {
		return clusterNode.node_state.includes('fail?');
	}

	static isFail (clusterNode, strict = true) {
		return clusterNode.node_state.includes('fail') || (!strict && clusterNode.node_state.includes('fail?'));
	}

	static isClusterEmpty (clusterInfo) {
		return clusterInfo && clusterInfo.cluster_state === 'fail' && (clusterInfo.cluster_size === '0' || clusterInfo.cluster_size === '1');
	}

	static getBlockedKey (env) {
		return `${env.CLUSTER_NAMESPACE}:blocked`;
	}

	static getTimestampKey (env) {
		return `${env.CLUSTER_NAMESPACE}:clusterCreationTimestamp`;
	}

}

module.exports = ClusterHelpers;
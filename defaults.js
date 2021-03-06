'use strict';
require('dotenv').config();
process.env.CUTOFF_HEALTHCHECK_ATTEMPTS = process.env.CUTOFF_HEALTHCHECK_ATTEMPTS || 3;
process.env.NODE_HEALTHCHECK_INTERVAL = process.env.NODE_HEALTHCHECK_INTERVAL || 100;
process.env.NODE_DISCOVERY_INTERVAL = process.env.NODE_DISCOVERY_INTERVAL || 100;
process.env.NODE_DISCOVERY_RANDOM_DELAY = process.env.NODE_DISCOVERY_RANDOM_DELAY || 100;
process.env.NODE_DISCOVERY_FAMILY = process.env.NODE_DISCOVERY_FAMILY || 4;
process.env.PROCESS_INTERVAL = process.env.PROCESS_INTERVAL || 1000;
process.env.NODE_DISCOVERY_HOSTNAME = process.env.NODE_DISCOVERY_HOSTNAME || 'redis';
process.env.PROCESS_TTL = process.env.PROCESS_TTL || 2000;
process.env.LEADER_TTL = parseInt(process.env.PROCESS_TTL)+parseInt(process.env.PROCESS_INTERVAL);
process.env.LEADER_REQUIRED_ACKS = process.env.LEADER_REQUIRED_ACKS || 5;
process.env.CLUSTER_NAMESPACE = process.env.CLUSTER_NAMESPACE || 'redis-cluster';
process.env.HTTP_SERVER_PORT = process.env.HTTP_SERVER_PORT || 80;
process.env.REDIS_NODE_PORT = process.env.REDIS_NODE_PORT || 6379;
process.env.REDIS_STANDALONE_PORT = process.env.REDIS_STANDALONE_PORT || parseInt(process.env.REDIS_NODE_PORT)+1;
process.env.CLUSTER_SIZE = process.env.CLUSTER_SIZE || 6;
process.env.CLUSTER_REPLICAS = process.env.CLUSTER_REPLICAS || 1;
process.env.LOG_FORMAT = process.env.LOG_FORMAT || 'pretty';
process.env.LOG_OUTPUT = process.env.LOG_OUTPUT || 'stdout';
process.env.LOG_LEVEL = process.env.LOG_LEVEL || 'trace';
process.env.STANDALONE_CONFIG_PATH = process.env.STANDALONE_CONFIG_PATH || '/usr/local/etc/redis/redis-standalone.conf';
process.env.NODE_CONFIG_PATH = process.env.NODE_CONFIG_PATH || '/usr/local/etc/redis/redis-node.conf';
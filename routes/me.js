'use strict';
const {getInformation, setClusterSize} = require('../apps/me.js');
const send = require('@polka/send-type');
const {HTTP_OK} = require('../lib/constants.js');

module.exports = (app, {env, cluster, nodeProcess, discovery}) => {
	app
		.get('/me', async (request, response) => send(response, HTTP_OK, {data:
			await getInformation({
				env,
				cluster,
				nodeProcess
			})
		}))
		.post('/cluster/size', async (request, response) => send(response, HTTP_OK, {data:
			await setClusterSize({
				cluster_size:parseInt(request.body.cluster_size || env.CLUSTER_SIZE),
				cluster_replicas:parseInt(request.body.cluster_replicas || env.CLUSTER_REPLICAS),
				propagate:!Reflect.has(request.body, 'propagate') ? true : request.body.propagate
			}, {
				env,
				discovery
			})
		}));

	return app;
};
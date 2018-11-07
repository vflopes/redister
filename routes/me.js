'use strict';
const {getInformation,setClusterSize} = require('../apps/me.js');
const send = require('@polka/send-type');

module.exports = (app, {env,cluster,nodeProcess,discovery}) => {
	app
		.get('/me', async (request, response) => send(response, 200, {data:
			await getInformation({
				env,
				cluster,
				nodeProcess
			})
		}))
		.post('/cluster/size', async (request, response) => send(response, 200, {data:
			await setClusterSize({
				cluster_size:parseInt(request.body.cluster_size || env.CLUSTER_SIZE),
				propagate:!Reflect.has(request.body, 'propagate') ? true : request.body.propagate
			},{
				env,
				discovery
			})
		}));

	return app;
};
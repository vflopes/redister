'use strict';

const routes = {
	me:require('./me.js'),
	peers:require('./peers.js'),
	default:require('./default.js')
};

const proxy = new Proxy(
	routes,
	{
		get:(routes, route) => {
			return (...args) => {
				routes[route](...args);
				return proxy;
			};
		}
	}
);

module.exports = proxy;
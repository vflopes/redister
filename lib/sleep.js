'use strict';
const DEFAULT_DELAY = 1000;
module.exports = async (delay = null) => new Promise(
	(resolve) => setTimeout(resolve, delay || Math.floor(Math.random()*DEFAULT_DELAY))
);
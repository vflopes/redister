'use strict';
const {STATUS_CODES} = require('http');

const getNotFoundError = () => {
	return {
		status:'404',
		title:STATUS_CODES[404].toLowerCase()
	};
};

module.exports = {
	getNotFoundError
};
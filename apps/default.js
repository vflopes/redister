'use strict';
const {STATUS_CODES} = require('http');
const {HTTP_NOT_FOUND} = require('../lib/constants.js');

const getNotFoundError = () => {
	return {
		status:'404',
		title:STATUS_CODES[HTTP_NOT_FOUND].toLowerCase()
	};
};

module.exports = {
	getNotFoundError
};
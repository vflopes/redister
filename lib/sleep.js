'use strict';
module.exports = async (delay = null) => new Promise((resolve) => setTimeout(resolve, delay || Math.floor(Math.random()*1000)));
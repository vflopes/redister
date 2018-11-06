'use strict';
module.exports = (number) => number%2 === 0 ? (number/2)+1 : Math.ceil(number/2);
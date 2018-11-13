'use strict';
const crypto = require('crypto');
const MAXINT = 6;
const RBYTES = 8;
module.exports = (intSize = MAXINT) => crypto.randomBytes(RBYTES).readUIntLE(0, intSize > MAXINT ? MAXINT : intSize);
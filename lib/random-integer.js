'use strict';
const crypto = require('crypto');
module.exports = (intSize = 6) => crypto.randomBytes(8).readUIntLE(0, intSize > 6 ? 6 : intSize);
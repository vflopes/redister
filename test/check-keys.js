'use strict';
const execRedisCli = require('./exec-redis-cli.js');
const alpha = ['A','B','C','D','E','F','G','H','I','J','K','L','M','N'];

module.exports = {
	populateKeys:async (count) => {
		for (let x = 0;x < count;x++)
			await execRedisCli(`SET ${x}${alpha[x]} "${x}${alpha[x]}: hello \\"world\\""`);
	},
	checkKeys:async (count) => {
		for (let x = 0;x < count;x++) {
			let output = await execRedisCli(`GET ${x}${alpha[x]}`);
			if (output.stdout.substring(0,2) !== x+alpha[x])
				throw new Error(`Invalid output for key ${x}${alpha[x]}: ${output.stdout}`);
		}
	}
};
'use strict';
const {Writable} = require('stream');

class AofDecoder extends Writable {

	constructor(options) {
		super(options);
		this._state = 'empty';
		this._countNextLines = 0;
		this._countNextBytes = 0;
		this._command = [];
	}

	_write (chunk, encoding, callback) {

		const buffer = chunk.toString('utf8');
		const lines = buffer.split(/\n/).map((line) => line.replace(/\r/ig, ''));

		for (const line of lines) {

			if (this._state === 'empty' && line.charAt(0) === '*') {
				this._countNextLines = parseInt(line.substring(1));
				this._state = 'ready';
			} else if (this._state === 'ready' && line.charAt(0) === '$') {
				this._countNextBytes = parseInt(line.substring(1));
				this._state = 'reading';
			} else if (this._state === 'reading') {
				let command = line.substring(0, this._countNextBytes);
				if (/[\s'"]/.test(command))
					command = JSON.stringify(command);
				this._command.push(command);
				this._state = 'ready';
				this._countNextBytes = 0;
				this._countNextLines--;
			}

			if (this._countNextLines === 0) {
				if (this._command.length > 0) {
					this.emit('command', this._command.join(' '));
					this._command = [];
				}
				this._state = 'empty';
			}

		}

		callback();

	}

	_final (callback) {
		callback();
	}

}

module.exports = AofDecoder;
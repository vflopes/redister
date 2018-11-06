'use strict';
const shortid = require('shortid');
const EventEmitter = require('events');
const os = require('os');

class Logger extends EventEmitter {

	constructor () {

		super();

		this._outputFunction = () => {};

	}

	static parseStack (stack) {
		return stack.split('\n').map((stackItem) => stackItem.trim());
	}

	setOutput (output) {

		switch (output) {
			case 'discard':
				this._outputFunction = () => {};
				break;
			case 'stdout':
			case 'console':
			default:
				this._outputFunction = console.log;
				break;

		}

		return this;

	}

	setFormat (format) {

		switch (format) {
			case 'pretty':
				this.on('log', (logEntry) => this._outputFunction(`${logEntry.timestamp}\t[${logEntry.address}|${logEntry.trackerId}]\t[${logEntry.level.toUpperCase()}]\t${logEntry.message}`));
				break;
			case 'json':
			default:
				this.on('log', (logEntry) => this._outputFunction(JSON.stringify(logEntry)));
				break;
		}

		return this;

	}

	stringifyError (error, stringifyStack = false) {

		if (!error)
			return null;

		let errorString = error.message;

		if (stringifyStack && error.stack)
			errorString += ' ['+Logger.parseStack(error.stack).join('|')+']';

		return errorString;

	}

	log (level, ...args) {

		let source = {};
		let message;
		let stack = null;

		if (args.length === 2) {
			source = args[0];
			message = args[1];
		} else if (args.length === 1)
			message = args[0];

		if (message.stack)
			stack = Logger.parseStack(message.stack);

		if (message.message)
			message = message.message;

		const logEntry = {
			level,
			message,
			stack,
			address:source.address || os.hostname(),
			trackerId:source.trackerId || shortid.generate(),
			timestamp:new Date().toISOString()
		};

		this.emit('log', logEntry);
		this.emit(`log.${level}`, logEntry);

		return this;

	}

	error (...args) {
		return this.log('error', ...args);
	}

	warn (...args) {
		return this.log('warn', ...args);
	}

	info (...args) {
		return this.log('info', ...args);
	}

	debug (...args) {
		return this.log('debug', ...args);
	}

	trace (...args) {
		return this.log('trace', ...args);
	}

};

Logger.logger = new Logger();

module.exports = Logger;
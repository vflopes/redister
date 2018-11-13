'use strict';
const shortid = require('shortid');
const EventEmitter = require('events');
const os = require('os');
const chalk = require('chalk');
const randomHexColor = require('./random-hex-color.js');

const levelValues = {
	'ERROR':700,
	'WARN':600,
	'INFO':400,
	'DEBUG':300,
	'TRACE':200
};

class Logger extends EventEmitter {

	constructor () {

		super();

		this._outputFunction = () => {};
		this._minimumLevel = 'TRACE';
		this._color = randomHexColor();

	}

	static parseStack (stack) {
		return stack.split('\n').map((stackItem) => stackItem.trim());
	}

	setMinimumLevel (minimumLevel) {
		this._minimumLevel = minimumLevel.toUpperCase();
		return this;
	}

	setOutput (output) {

		switch (output) {
		case 'discard':
			this._outputFunction = () => {};
			break;
		case 'stdout':
		case 'console':
		default:
			this._outputFunction = (message) => process.stdout.write(message+'\n');
			break;

		}

		return this;

	}

	_colorizeLevel (level) {
		switch (level) {
		case 'ERROR':
			return chalk.red.bold(level);
		case 'WARN':
			return chalk.yellow.bold(level);
		case 'INFO':
			return chalk.cyan.bold(level);
		case 'DEBUG':
			return chalk.blue.bold(level);
		default:
			return chalk.white.bold(level);
		}
	}

	setFormat (format) {

		switch (format) {
		case 'pretty':
			this.on('log', (logEntry) => this._outputFunction(`${logEntry.timestamp}\t[${chalk.hex(this._color).bold(logEntry.address)}|${logEntry.trackerId}]\t[${this._colorizeLevel(logEntry.level.toUpperCase())}]\t${logEntry.message}`));
			break;
		case 'json':
		default:
			this.on('log', (logEntry) => this._outputFunction(JSON.stringify(logEntry)));
			break;
		}

		return this;

	}

	stringifyError (error, stringifyStack = null) {

		if (!error)
			return null;

		if (stringifyStack === null)
			stringifyStack = this._minimumLevel === 'TRACE';

		let errorString = error.message;

		if (stringifyStack && error.stack)
			errorString += ' ['+Logger.parseStack(error.stack).join('|')+']';

		return errorString;

	}

	log (level, ...args) {

		const levelValue = levelValues[level.toUpperCase()] || levelValues.ERROR;
		if (levelValue < levelValues[this._minimumLevel])
			return this;

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

}

Logger.logger = new Logger();

module.exports = Logger;
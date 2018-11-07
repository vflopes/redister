'use strict';

const buildEnvironmentMap = (initialValues) => {
	return new Proxy(
		new Map(initialValues),
		{
			get:(map, key) => {
				key = key.toUpperCase();
				if (map.has(key))
					return map.get(key);
				return process.env[key];
			},
			set:(map, key, value) => {
				map.set(key.toUpperCase(), value);
				return true;
			}
		}
	);
};

const environmentMaps = new Map();

module.exports = (name = null, initialValues = []) => {
	if (!Array.isArray(initialValues) && typeof initialValues === 'object')
		initialValues = Object.keys(initialValues).map((key) => [key, initialValues[key]]);
	if (name === null)
		return buildEnvironmentMap(initialValues);
	if (!environmentMaps.has(name))
		environmentMaps.set(name, buildEnvironmentMap(initialValues));
	return environmentMaps.get(name);
};
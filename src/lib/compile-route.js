const debug = require('debug')('fetch-mock')
const generateMatcher = require('./generate-matcher');

const sanitizeRoute = (route, useDebugger = true) => {
	useDebugger && debug('Sanitizing route properties');
	route = Object.assign({}, route);

	if (route.method) {
		useDebugger && debug(`Converting method ${route.method} to lower case`);
		route.method = route.method.toLowerCase();
	}

	useDebugger && debug('Setting route.identifier...')
	useDebugger && debug(`- route.name is ${route.name}`)
	useDebugger && debug(`- route.matcher is ${route.matcher}`)
	route.identifier = route.name || route.matcher;
	useDebugger && debug(`=> route.identifier set to ${route.identifier}`);
	return route;
};

const validateRoute = route => {
	if (!('response' in route)) {
		throw new Error('fetch-mock: Each route must define a response');
	}

	if (!route.matcher) {
		throw new Error(
			'fetch-mock: Each route must specify a string, regex or function to match calls to fetch'
		);
	}
};

const limitMatcher = route => {
	debug('Limiting number of requests to handle by route');
	if (!route.repeat) {
		debug('No `repeat` value set on route. Will match any number of requests')
		return;
	}

	debug(`Route set to repeat ${route.repeat} times`)
	const matcher = route.matcher;
	let timesLeft = route.repeat;
	route.matcher = (url, options) => {
		const match = timesLeft && matcher(url, options);
		if (match) {
			timesLeft--;
			return true;
		}
	};
	route.reset = () => (timesLeft = route.repeat);
};

module.exports = route => {
	debug('Compiling route');
	validateRoute(route);
	route = sanitizeRoute(route);
	route.matcher = generateMatcher(route);
	limitMatcher(route);
	return route;
};

module.exports.sanitizeRoute = sanitizeRoute;

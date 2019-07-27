const debug = require('debug')('fetch-mock');
const glob = require('glob-to-regexp');
const pathToRegexp = require('path-to-regexp');
const querystring = require('querystring');
const {
	headers: headerUtils,
	getPath,
	getQuery,
	normalizeUrl
} = require('./request-utils');

const debuggableUrlFunc = func => url => {
	debug('Actual url:', url);
	return func(url);
};

const stringMatchers = {
	begin: targetString =>
		debuggableUrlFunc(url => url.indexOf(targetString) === 0),
	end: targetString =>
		debuggableUrlFunc(url => url.substr(-targetString.length) === targetString),
	glob: targetString => {
		const urlRX = glob(targetString);
		return debuggableUrlFunc(url => urlRX.test(url));
	},
	express: targetString => {
		const urlRX = pathToRegexp(targetString);
		return debuggableUrlFunc(url => urlRX.test(getPath(url)));
	},
	path: targetString => debuggableUrlFunc(url => getPath(url) === targetString)
};

const getHeaderMatcher = ({ headers: expectedHeaders }) => {
	debug('Generating header matcher');
	if (!expectedHeaders) {
		debug('  No header expectations defined - skipping');
		return;
	}
	const expectation = headerUtils.toLowerCase(expectedHeaders);
	debug('  Expected headers:', expectation);
	return (url, { headers = {} }) => {
		debug('Attempting to match headers');
		const lowerCaseHeaders = headerUtils.toLowerCase(
			headerUtils.normalize(headers)
		);
		debug('  Expected headers:', expectation);
		debug('  Actual headers:', lowerCaseHeaders);
		return Object.keys(expectation).every(headerName =>
			headerUtils.equal(lowerCaseHeaders[headerName], expectation[headerName])
		);
	};
};

const getMethodMatcher = ({ method: expectedMethod }) => {
	debug('Generating method matcher');
	if (!expectedMethod) {
		debug('  No method expectations defined - skipping');
		return;
	}
	debug('  Expected method:', expectedMethod);
	return (url, { method }) => {
		debug('Attempting to match method');
		const actualMethod = method ? method.toLowerCase() : 'get';
		debug('  Expected method:', expectedMethod);
		debug('  Actual method:', actualMethod);
		return expectedMethod === actualMethod;
	};
};

const getQueryStringMatcher = ({ query: expectedQuery }) => {
	debug('Generating query parameters matcher');
	if (!expectedQuery) {
		debug('  No query parameters expectations defined - skipping');
		return;
	}
	debug('  Expected query parameters:', expectedQuery);
	const keys = Object.keys(expectedQuery);
	return url => {
		debug('Attempting to match query parameters');
		const query = querystring.parse(getQuery(url));
		debug('  Expected query parameters:', expectedQuery);
		debug('  Actual query parameters:', query);
		return keys.every(key => query[key] === expectedQuery[key]);
	};
};

const getParamsMatcher = ({ params: expectedParams, matcher }) => {
	debug('Generating path parameters matcher');
	if (!expectedParams) {
		debug('  No path parameters expectations defined - skipping');
		return;
	}
	if (!/express:/.test(matcher)) {
		throw new Error(
			'fetch-mock: matching on params is only possible when using an express: matcher'
		);
	}
	debug('  Expected path parameters:', expectedParams);
	const expectedKeys = Object.keys(expectedParams);
	const keys = [];
	const re = pathToRegexp(matcher.replace(/^express:/, ''), keys);
	return url => {
		debug('Attempting to match path parameters');
		const vals = re.exec(getPath(url)) || [];
		vals.shift();
		const params = keys.reduce(
			(map, { name }, i) =>
				vals[i] ? Object.assign(map, { [name]: vals[i] }) : map,
			{}
		);
		debug('  Expected path parameters:', expectedParams);
		debug('  Actual path parameters:', params);
		return expectedKeys.every(key => params[key] === expectedParams[key]);
	};
};

const getFunctionMatcher = ({ matcher, functionMatcher }) => {
	if (functionMatcher) {
		debug('Using user defined function as matcher alongside other matchers');
		return functionMatcher;
	}
	if (typeof matcher === 'function') {
		debug('Using user defined function as matcher');
		return matcher;
	}
};

const getUrlMatcher = route => {
	debug('Generating url matcher');
	const { matcher, query } = route;

	if (typeof matcher === 'function') {
		debug('  No url matching rules defined');
		return;
	}

	if (matcher instanceof RegExp) {
		debug('  Using regular expression to match url:', matcher);
		return url => matcher.test(url);
	}

	if (matcher === '*') {
		debug('  Using universal * rule to match any url');
		return () => true;
	}

	for (const shorthand in stringMatchers) {
		if (matcher.indexOf(shorthand + ':') === 0) {
			debug(`  Using ${shorthand}: pattern to match url`, matcher);
			const url = matcher.replace(new RegExp(`^${shorthand}:`), '');
			return stringMatchers[shorthand](url);
		}
	}

	// if none of the special syntaxes apply, it's just a simple string match
	// but we have to be careful to normalize the url we check and the name
	// of the route to allow for e.g. http://it.at.there being indistinguishable
	// from http://it.at.there/ once we start generating Request/Url objects
	debug('  Matching using full url', matcher);
	const expectedUrl = normalizeUrl(matcher);
	debug('  Normalised url to:', matcher);
	if (route.identifier === matcher) {
		debug('  Updating route identifier to match normalized url:', matcher);
		route.identifier = expectedUrl;
	}

	return url => {
		debug('Expected url:', expectedUrl);
		debug('Actual url:', url);
		if (query && expectedUrl.indexOf('?')) {
			debug('Ignoring query string when matching url');
			return url.indexOf(expectedUrl) === 0;
		}
		return normalizeUrl(url) === expectedUrl;
	};
};

module.exports = (route, useDebugger = true) => {
	useDebugger && debug('Compiling matcher for route');
	const matchers = [
		getQueryStringMatcher(route),
		getMethodMatcher(route),
		getHeaderMatcher(route),
		getParamsMatcher(route),
		getFunctionMatcher(route),
		getUrlMatcher(route)
	].filter(matcher => !!matcher);

	return (url, options = {}, request) =>
		matchers.every(matcher => matcher(url, options, request));
};

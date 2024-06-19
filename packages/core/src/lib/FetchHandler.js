import responseBuilder from './response-builder.js';
import * as requestUtils from './request-utils.js';

/** 
 * @typedef FetchHandler
 * An object that contains the fetch handler function - used as the mock for
 * fetch - and various utilities to help it operate
 * This object will never be accessed as a separate entity by the end user as it
 * gets munged with Router and CallHistory objects by FetchMockWrapper
 * 
 */
const FetchHandler = {};

const resolve = async (
    { response, responseIsFetch = false },
    url,
    options,
    request,
) => {
    // We want to allow things like
    // - function returning a Promise for a response
    // - delaying (using a timeout Promise) a function's execution to generate
    //   a response
    // Because of this we can't safely check for function before Promisey-ness,
    // or vice versa. So to keep it DRY, and flexible, we keep trying until we
    // have something that looks like neither Promise nor function
    //eslint-disable-next-line no-constant-condition
    while (true) {
        if (typeof response === 'function') {
            // in the case of falling back to the network we need to make sure we're using
            // the original Request instance, not our normalised url + options
            if (responseIsFetch) {
                if (request) {
                    return response(request);
                }
                return response(url, options);
            }
            response = response(url, options, request);
        } else if (typeof response.then === 'function') {
            response = await response; // eslint-disable-line  no-await-in-loop
        } else {
            return response;
        }
    }
};

FetchHandler.fetchHandler = async function (url, options) {
    const { url, options, request, signal } = requestUtils.normalizeRequest(
        url,
        options,
        this.config.Request,
    );

    if (this.router.needsToReadBody(normalizedRequest)) {
        options.body = await normalizedRequest.options.body;
    }

    const { route, callLog } = this.router.execute(url, options, request);

    this.callHistory.recordCall(callLog);

    // this is used to power the .flush() method
    let done;
    this._holdingPromises.push(
        new Promise((res) => {
            done = res;
        }),
    );

    if (signal) {
        const abort = () => {
            rej(new DOMException('The operation was aborted.', 'AbortError'));
            done();
        };
        if (signal.aborted) {
            abort();
        }
        signal.addEventListener('abort', abort);
    }

    return this.generateResponse({
        route,
        url,
        options,
        request,
        callLog,
    })
        .then(done, done)
};

FetchHandler.fetchHandler.isMock = true;

FetchHandler.generateResponse = async function ({
    route,
    url,
    options,
    request,
    callLog = {},
}) {
    const response = await resolve(route, url, options, request);

    // If the response says to throw an error, throw it
    // Type checking is to deal with sinon spies having a throws property :-0
    if (response.throws && typeof response !== 'function') {
        throw response.throws;
    }

    // If the response is a pre-made Response, respond with it
    if (this.config.Response.prototype.isPrototypeOf(response)) {
        callLog.response = response;
        return response;
    }

    // finally, if we need to convert config into a response, we do it
    const [realResponse, finalResponse] = responseBuilder({
        url,
        responseConfig: response,
        fetchMock: this,
        route,
    });

    callLog.response = realResponse;

    return finalResponse;
};

export default FetchHandler;

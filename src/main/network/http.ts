// ==LICENSE-BEGIN==
// Copyright 2017 European Digital Reading Lab. All rights reserved.
// Licensed to the Readium Foundation under one or more contributor license agreements.
// Use of this source code is governed by a BSD-style license
// that can be found in the LICENSE file exposed on Github (readium) in the project repository.
// ==LICENSE-END==

import * as debug_ from "debug";
import * as https from "https";
import { Headers, RequestInit } from "node-fetch";
import { AbortSignal as IAbortSignal } from "node-fetch/externals";
import {
    IHttpGetResult, THttpGetCallback, THttpOptions, THttpResponse,
} from "readium-desktop/common/utils/http";
import { IS_DEV } from "readium-desktop/preprocessor-directives";
import { tryCatch, tryCatchSync } from "readium-desktop/utils/tryCatch";
import { resolve } from "url";

import { ConfigRepository } from "../db/repository/config";
import { diMainGet } from "../di";
import { fetchWithCookie } from "./fetch";

// Logger
const filename_ = "readium-desktop:main/http";
const debug = debug_(filename_);

const DEFAULT_HTTP_TIMEOUT = 30000;

// https://github.com/node-fetch/node-fetch/blob/master/src/utils/is-redirect.js
const redirectStatus = new Set([301, 302, 303, 307, 308]);

/**
 * Redirect code matching
 *
 * @param {number} code - Status code
 * @return {boolean}
 */
const isRedirect = (code: number) => {
    return redirectStatus.has(code);
};

const FOLLOW_REDIRECT_COUNTER = 20;

export const httpSetHeaderAuthorization =
    (type: string, credentials: string) => `${type} ${credentials}`;

// tslint:disable-next-line: variable-name
const CONFIGREPOSITORY_OPDS_AUTHENTICATION_TOKEN_fn =
    (hostname: string) => `CONFIGREPOSITORY_OPDS_AUTHENTICATION_TOKEN.${Buffer.from(hostname).toString("base64")}`;

export interface IOpdsAuthenticationToken {
    id?: string;
    opdsAuthenticationUrl?: string; // application/opds-authentication+json
    refreshUrl?: string;
    authenticateUrl?: string;
    accessToken?: string;
    refreshToken?: string;
    tokenType?: string;
}

export const httpSetToConfigRepoOpdsAuthenticationToken =
(data: IOpdsAuthenticationToken) => tryCatch(
    async () => {

        const url = new URL(data.opdsAuthenticationUrl);
        const { hostname } = url;
        const configRepo = diMainGet("config-repository");
        await configRepo.save({
            identifier: CONFIGREPOSITORY_OPDS_AUTHENTICATION_TOKEN_fn(hostname),
            value: data,
        });
    },
    filename_,
);

export async function httpFetchRawResponse(
    url: string | URL,
    options: THttpOptions = {},
    redirectCounter = 0,
    locale = tryCatchSync(() => diMainGet("store")?.getState()?.i18n?.locale, filename_) || "en-US",
): Promise<THttpResponse> {

    options.headers = options.headers instanceof Headers
        ? options.headers
        : new Headers(options.headers || {});
    options.headers.set("user-agent", "readium-desktop");
    options.headers.set("accept-language", `${locale},en-US;q=0.7,en;q=0.5`);
    options.redirect = "manual"; // handle cookies

    // https://github.com/node-fetch/node-fetch#custom-agent
    // httpAgent doesn't works // err: Protocol "http:" not supported. Expected "https:
    // this a nodeJs issues !
    //
    // const httpAgent = new http.Agent({
    //     timeout: options.timeout || DEFAULT_HTTP_TIMEOUT,
    // });
    // options.agent = (parsedURL: URL) => {
    //     if (parsedURL.protocol === "http:") {
    //           return httpAgent;
    //     } else {
    //           return httpsAgent;
    //     }
    // };
    if (!options.agent && url.toString().startsWith("https:")) {
        const httpsAgent = new https.Agent({
            timeout: options.timeout || DEFAULT_HTTP_TIMEOUT,
            rejectUnauthorized: IS_DEV ? false : true,
        });
        options.agent = httpsAgent;
    }
    options.timeout = options.timeout || DEFAULT_HTTP_TIMEOUT;

    const response = await fetchWithCookie(url, options);

    debug("fetch URL:", url);
    debug("Request headers :");
    debug(options.headers);
    debug("###");
    debug("OK: ", response.ok);
    debug("status code :", response.status);
    debug("status text :", response.statusText);

    // manual Redirect to handle cookies
    // https://github.com/node-fetch/node-fetch/blob/0d35ddbf7377a483332892d2b625ec8231fa6181/src/index.js#L129
    if (isRedirect(response.status)) {

        const location = response.headers.get("Location");
        debug("Redirect", response.status, "to: ", location);

        if (location) {
            const locationUrl = resolve(response.url, location);

            if (redirectCounter > FOLLOW_REDIRECT_COUNTER) {
                throw new Error(`maximum redirect reached at: ${url}`);
            }

            if (
                response.status === 303 ||
                ((response.status === 301 || response.status === 302) && options.method === "POST")
            ) {
                options.method = "GET";
                options.body = undefined;
                if (options.headers) {
                    if (!(options.headers instanceof Headers)) {
                        options.headers = new Headers(options.headers);
                    }
                    options.headers.delete("content-length");
                }
            }

            return await httpFetchRawResponse(locationUrl, options, redirectCounter + 1, locale);
        } else {
            debug("No location URL to redirect");
        }
    }

    return response;
}

export async function httpFetchFormattedResponse<TData = undefined>(
    url: string | URL,
    options?: THttpOptions,
    callback?: THttpGetCallback<TData>,
    locale?: string,
): Promise<IHttpGetResult<TData>> {

    let result: IHttpGetResult<TData> = {
        isFailure: true,
        isSuccess: false,
        url,
    };

    try {
        const response = await httpFetchRawResponse(url, options, 0, locale);

        debug("Response headers :");
        debug({ ...response.headers.raw() });
        debug("###");

        result = {
            isAbort: false,
            isNetworkError: false,
            isTimeout: false,
            isFailure: !response.ok/*response.status < 200 || response.status >= 300*/,
            isSuccess: response.ok/*response.status >= 200 && response.status < 300*/,
            url,
            responseUrl: response.url,
            statusCode: response.status,
            statusMessage: response.statusText,
            body: response.body,
            response,
            data: undefined,
            contentType: response.headers.get("Content-Type"),
            // cookies: response.headers.get("Set-Cookie"),
        };
    } catch (err) {

        const errStr = err.toString();

        debug(errStr);

        if (err.name === "AbortError") {
            result = {
                isAbort: true,
                isNetworkError: false,
                isTimeout: false,
                isFailure: true,
                isSuccess: false,
                url,
            };
        } else if (errStr.includes("timeout")) { // err.name === "FetchError"
            result = {
                isAbort: false,
                isNetworkError: true,
                isTimeout: true,
                isFailure: true,
                isSuccess: false,
                url,
                statusMessage: errStr,
            };
        } else { // err.name === "FetchError"
            result = {
                isAbort: false,
                isNetworkError: true,
                isTimeout: false,
                isFailure: true,
                isSuccess: false,
                url,
                statusMessage: errStr,
            };
        }

    } finally {

        if (callback) {
            result = await Promise.resolve(callback(result));

            // remove for IPC sync
            result.body = undefined;
            result.response = undefined;
        }
    }

    return result;
}

export const httpGetWithAuth =
    (enableAuth = true): typeof httpFetchFormattedResponse =>
        async (...arg) => {

            const [_url, _options, ..._arg] = arg;

            const options = _options || {};
            options.method = "GET";

            const response = await httpFetchFormattedResponse(_url, options, ..._arg);

            if (enableAuth && response.statusCode === 401) {

                const url = _url instanceof URL ? _url : new URL(_url);
                const { hostname } = url;

                const auth = await tryCatch(
                    async () => {
                        const id = CONFIGREPOSITORY_OPDS_AUTHENTICATION_TOKEN_fn(hostname);
                        const configRepo = diMainGet("config-repository") as ConfigRepository<IOpdsAuthenticationToken>;
                        const doc = await configRepo.get(id);
                        return doc?.value;
                    },
                    filename_,
                );

                if (
                    typeof auth === "object"
                    && auth.accessToken
                ) {
                    return httpGetUnauthorized(auth)(_url, options, ..._arg);
                } else {
                    debug("there are no authentication credentials in configRepo");
                }

            }
            return response;
        };

export const httpGet = httpGetWithAuth(true);

const httpGetUnauthorized =
    (auth: IOpdsAuthenticationToken, enableRefresh = true): typeof httpFetchFormattedResponse =>
        async (...arg) => {

            const [_url, _options, ..._arg] = arg;

            const url = _url instanceof URL ? _url : new URL(_url);
            const options = _options || {};

            const { accessToken, tokenType } = auth;

            options.headers = options.headers instanceof Headers
                ? options.headers
                : new Headers(options.headers || {});

            options.headers.set("Authorization", httpSetHeaderAuthorization(tokenType || "Bearer", accessToken));

            const response = await httpGetWithAuth(false)(url, options, ..._arg);

            if (enableRefresh && response.statusCode === 401) {
                if (auth.refreshUrl && auth.refreshToken) {
                    const responseAfterRefresh = await httpGetUnauthorizedRefresh(auth)(url, options, ..._arg);
                    return responseAfterRefresh || response;
                }
            }
            return response;
        };

const httpGetUnauthorizedRefresh =
    (auth: IOpdsAuthenticationToken): typeof httpFetchFormattedResponse =>
        async (...arg) => {

            const { refreshToken, refreshUrl } = auth;
            const options: RequestInit = {};
            options.headers = options.headers instanceof Headers
                ? options.headers
                : new Headers(options.headers || {});
            options.headers.set("Content-Type", "application/json");

            options.body = JSON.stringify({
                refresh_token: refreshToken,
                grant_type: "refresh_token",
            });

            const httpPostResponse = await httpPost(refreshUrl, options);
            if (httpPostResponse.isSuccess) {
                const jsonDataResponse = await httpPostResponse.response.json();

                const newRefreshToken = typeof jsonDataResponse?.refresh_token === "string"
                    ? jsonDataResponse.refresh_token
                    : undefined;
                auth.refreshToken = newRefreshToken || auth.refreshToken;

                const newAccessToken = typeof jsonDataResponse?.access_token === "string"
                    ? jsonDataResponse.access_token
                    : undefined;
                auth.accessToken = newAccessToken || auth.accessToken;

                const httpGetResponse = await httpGetUnauthorized(auth, false)(...arg);

                if (httpGetResponse.statusCode !== 401) {

                    debug("authenticate with the new access_token");
                    debug("saved it into db");
                    await httpSetToConfigRepoOpdsAuthenticationToken(auth);
                }
                return httpGetResponse;
            }

            return undefined;
        };

export const httpPost: typeof httpFetchFormattedResponse =
    async (...arg) => {

        let [, options] = arg;

        options = options || {};
        options.method = "POST";
        arg[1] = options;

        return httpFetchFormattedResponse(...arg);
    };

// fetch checks the class name
// https://github.com/node-fetch/node-fetch/blob/b7076bb24f75be688d8fc8b175f41b341e853f2b/src/utils/is.js#L78
export class AbortSignal implements IAbortSignal {

    public aborted: boolean;
    private listenerArray: any[];

    constructor() {
        this.listenerArray = [];
        this.aborted = false;
    }

    // public get aborted() {
    //     return this._aborted;
    // }

    public addEventListener(_type: "abort", listener: (a: any[]) => any) {
        this.listenerArray.push(listener);
    }

    public removeEventListener(_type: "abort", listener: (a: any[]) => any) {
        const index = this.listenerArray.findIndex((v) => v === listener);
        if (index > -1) {
            this.listenerArray = [...this.listenerArray.slice(0, index), ...this.listenerArray.slice(index + 1)];
        }
    }

    public dispatchEvent() {
        this.listenerArray.forEach((l) => {
            try {
                l();
            } catch (e) {
                // ignore
            }
        });
        return this.aborted = true;
    }
}
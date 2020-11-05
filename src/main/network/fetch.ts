// ==LICENSE-BEGIN==
// Copyright 2017 European Digital Reading Lab. All rights reserved.
// Licensed to the Readium Foundation under one or more contributor license agreements.
// Use of this source code is governed by a BSD-style license
// that can be found in the LICENSE file exposed on Github (readium) in the project repository.
// ==LICENSE-END==

import * as nodeFetchCookie from "fetch-cookie";
import nodeFetch from "node-fetch";
import { tryCatch } from "readium-desktop/utils/tryCatch";
import * as tougth from "tough-cookie";
import { diMainGet } from "../di";

let fetchLocal: typeof nodeFetch;
let cookieJar: tougth.CookieJar;

const CONFIGREPOSITORY_COOKIEJAR = "CONFIGREPOSITORY_COOKIEJAR";

// src/main/redux/sagas/app.ts
export const fetchCookieJarPersistence = async () => {

    if (cookieJar) {

        const configRepo = diMainGet("config-repository");
        await configRepo.save({
            identifier: CONFIGREPOSITORY_COOKIEJAR,
            value: cookieJar.serializeSync(),
        });
    }
};

const fetchFactory = async () => {

    await tryCatch(async () => {

        const configRepo = diMainGet("config-repository");
        const data = await configRepo.get(CONFIGREPOSITORY_COOKIEJAR);
        if (data?.value) {
            cookieJar = tougth.CookieJar.deserializeSync(data.value);
        }

    }, "src/main/network/fetch");

    if (!cookieJar) {
        cookieJar = new tougth.CookieJar();
    }

    const _fetch = nodeFetchCookie(nodeFetch, cookieJar, false); // doesn't ignore errors

    return _fetch;
};

export const fetchWithCookie =
    async (...arg: Parameters<typeof nodeFetch>) =>
        (fetchLocal = fetchLocal || await fetchFactory())(...arg);

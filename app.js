import axios from 'axios';
import { wrapper } from 'axios-cookiejar-support';
import fs from 'fs';
import path from 'path';
import qs from 'qs';
import readline from 'readline';
import { CookieJar } from 'tough-cookie';
const base = 'https://web.budgetbakers.com';
const endpoint = `${base}/api`;
const jar = new CookieJar();
const client = wrapper(axios.create({ jar, withCredentials: true }));
let userId = null;

/**
 * Requests an SSO key for the provided e-mail address.
 * @param {string} email - The e-mail address to request SSO login for.
 * @returns {Promise<string>} Resolves with the SSO key when successful.
 * @throws {Error} If the API call fails or response does not contain an SSO key.
 */
const requestLogin = (email) => new Promise((resolve, reject) => {
    client.post(`${endpoint}/trpc/user.ssoSignInEmail?batch=1`, {
        "0" : { "json": email }
    }, {
        headers: {
            'Content-Type': 'application/json'
        }
    })  
        .then((res) => {
            const ssoKey = res.data[0]?.result?.data?.json;
            if (ssoKey) {
                resolve(ssoKey);
            } else {
                reject(Error('Requesting login failed', { cause: `No SSO key in response: ${JSON.stringify(res.data)}` }));
            }
        })
        .catch((err) => reject(Error('Requesting login failed', { cause: JSON.stringify(err.response.data) })));
});

/**
 * Prompts the user to paste the SSO token or link sent to their e-mail.
 * Accepts either the raw token or the full link and normalizes to the token.
 * @returns {Promise<string>} Resolves with the SSO token string.
 * @throws {Error} If no input is provided.
 */
const requestSsoToken = () => new Promise((resolve, reject) => {
    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout
    });
    rl.question('Enter the link or SSO token that was sent to your e-mail: ', (input) => {
        rl.close();
        if (!input) { reject(Error('Link or SSO token is required')); }
        if (input.includes(`${base}/sso?ssoToken=`)) {
            resolve(input.replace(`${base}/sso?ssoToken=`, ''));
        } else {
            resolve(input);
        }
    });
});

/**
 * Exchanges SSO key and SSO token for an auth token.
 * @param {string} email - The user e-mail associated with the SSO flow.
 * @param {string} ssoKey - The SSO key returned by requestLogin.
 * @param {string} ssoToken - The SSO token provided by the user (from e-mail).
 * @returns {Promise<string>} Resolves with the authentication token.
 * @throws {Error} If the API call fails or the auth token is missing in the response.
 */
const getAuthTokenInfo = (email, ssoKey, ssoToken) => new Promise((resolve, reject) => {
    client.post(`${endpoint}/trpc/user.confirmSsoAuth?batch=1`, {
        "0" : { "json": { 
            ssoKey, 
            ssoToken,
            userEmail: email
    } } }, {        
        headers: {
            'Content-Type': 'application/json'
        }
    })  
        .then((res) => {
            const tokenInfo = res.data[0]?.result?.data?.json;
            if (tokenInfo) {
                resolve(tokenInfo);
            } else{
                reject(Error('Getting auth token info failed', { cause: `No auth token info in response: ${JSON.stringify(res.data)}` }));
            }
        })
        .catch((err) => reject(Error('Getting auth token info failed', { cause: JSON.stringify(err.response.data) })));
});

/**
 * Retrieves a CSRF token from the API.
 * @returns {Promise<string>} Resolves with the CSRF token string.
 * @throws {Error} If the request fails or the response does not contain a CSRF token.
 */
const getCsrfToken = () => new Promise((resolve, reject) => {
    client.get(`${endpoint}/auth/csrf`)
        .then((res) => {
            const csrfToken = res.data.csrfToken;
            if (csrfToken) {
                resolve(csrfToken);
            } else {
                reject(Error('Getting CSRF token failed', { cause: `No CSRF token in response: ${JSON.stringify(res.data)}` }));
            }
        })
        .catch((err) => reject(Error('Getting CSRF token failed', { cause: JSON.stringify(err.response.data) })));
});

/**
 * Exchanges auth and CSRF tokens for a session cookie and extracts the session token.
 * @param {string} authTokenInfo - The authentication token info from getAuthTokenInfo.
 * @param {string} csrfToken - The CSRF token from getCsrfToken.
 * @returns {Promise<string>} Resolves with the session token string.
 * @throws {Error} If setting the session token fails or the token cannot be extracted.
 */
const setSessionToken = async (authTokenInfo, csrfToken) => {
    try {
        const callbackUrl = (await jar.getCookies(base)).find((cookie) => cookie.key.includes('callback-url'))?.value || base;
        const sessionRes = await client.post(`${endpoint}/auth/callback/sso`, qs.stringify({
            token: authTokenInfo.token,
            refreshPossibleAt: authTokenInfo.refreshPossibleAt,
            csrfToken,
            callbackUrl,
            json: 'true',
            redirect: 'false'
        }), {
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
                'Origin': base,
                'Sec-Fetch-Dest': 'empty',
                'Sec-Fetch-Mode': 'cors',
                'Sec-Fetch-Site': 'same-origin'
            }
        });
        const sessionToken = sessionRes.headers['set-cookie']
            ?.find((cookie) => cookie.startsWith('__Secure-next-auth.session-token='))
            ?.split(';')[0].split('=')[1];
        if (sessionToken) {
            return sessionToken;
        } else {
            throw Error('Setting session token failed', { cause: `No session token in response: ${JSON.stringify({ headers: sessionRes.headers, data: sessionRes.data })}` });
        }
    } catch (err) {
        const resp = err?.response;
        const errData = resp ? JSON.stringify(resp.data) : err;
        throw Error('Setting session token failed', { cause: errData });
    }
};

/**
 * Retrieves the authenticated user's BudgetBakers user id.
 * @returns {Promise<string>} Resolves with the user id.
 * @throws {Error} If the user id cannot be retrieved or is missing from the response.
 */
const getUserId = () => new Promise((resolve, reject) => {
    client.get(`${endpoint}/trpc/user.getUser?batch=1&input=${encodeURIComponent(JSON.stringify({"0": { json: null, meta: { values: ["undefined"] } } }))}`)
        .then((res) => {
            const userId = res.data[0]?.result?.data?.json?.userId;
            if (userId) {
                resolve(userId);
            } else {
                reject(Error('Getting user id failed', { cause: `No user id in response: ${JSON.stringify(res.data)}` }));
            }
        })
        .catch((err) => reject(Error('Getting user id failed', { cause: JSON.stringify(err.response.data) })));
});

/**
 * Reuses the locally stored session token and refreshes the cached user id.
 * @returns {Promise<{sessionToken: string, userId: string}>} Resolves with the reused session token and user id.
 * @throws {Error} If no token exists or the stored token is no longer valid.
 */
const reuseToken = async () => {
    const sessionToken = fs.existsSync('TOKEN') ? fs.readFileSync('TOKEN', 'utf-8').trim() : null;
    if (!sessionToken) { throw Error('No session token found'); }
    try {
        await jar.setCookie(`__Secure-next-auth.session-token=${sessionToken}; Path=/; Secure; HttpOnly; SameSite=Lax`, base);
        userId = await getUserId();
        fs.writeFileSync('TOKEN', sessionToken);
        return sessionToken;
    } catch (err) {
        throw Error('Reusing session token failed', { cause: err });
    }
}

/**
 * Authenticates a user with the BudgetBakers API.
 * @param {string} email - The e-mail address to use for login.
 * @returns {Promise<{sessionToken: string, userId: string}>} Resolves with sessionToken and userId after successful authentication.
 * @throws {Error} If the e-mail address is missing or the login process fails.
 */
const login = async (email) => {
    if (!email) { throw Error('Login failed', { cause: 'E-mail address is required' }); }

    let sessionToken = await reuseToken().catch(() => null);
    if (sessionToken) { return { sessionToken, userId }; }

    try {
        const ssoKey = await requestLogin(email);
        const ssoToken = await requestSsoToken();
        const authTokenInfo = await getAuthTokenInfo(email, ssoKey, ssoToken);
        const csrfToken = await getCsrfToken();
        sessionToken = await setSessionToken(authTokenInfo, csrfToken);
        userId = await getUserId();
        fs.writeFileSync('TOKEN', sessionToken);
        return { sessionToken, userId };
    } catch (err) {
        throw Error('Login failed', { cause: err });
    }
}

/**
 * Gets imported files from the BudgetBakers API.
 * @param {string|null} [accountId=null] - Optional account id used to filter imports.
 * @returns {Promise<Array<Object>>} Resolves with the imported files.
 * @throws {Error} If imported files cannot be retrieved.
 */
const getImports = (accountId = null) => new Promise((resolve, reject) => {    
    client.get(`${endpoint}/trpc/imports.getAllImportItems?batch=1&input=${encodeURIComponent(JSON.stringify({"0": { json: null, meta: { values: ["undefined"] } } }))}`)
        .then((res) => {
            const files = res.data[0]?.result?.data?.json?.data;
            if (!files) {
                return reject(Error('Retrieving imported files failed', { cause: `No imported files in response: ${JSON.stringify(res.data)}` }));
            }
            if (accountId) { return resolve(files.filter((file) => file.accountId == accountId)); }
            resolve(files);
        })
        .catch((err) => reject(Error('Retrieving imported files failed', { cause: JSON.stringify(err.response.data) })));
});

/**
 * Uploads a CSV file to the BudgetBakers import system.
 * @param {string} file - Path to the file to upload.
 * @param {string} importEmail - E-mail address associated with the import.
 * @returns {Promise<boolean>} Resolves with true when the upload succeeds.
 * @throws {Error} If the user id, file, or import e-mail is missing, or if the upload fails.
 */
const upload = (file, importEmail) => new Promise((resolve, reject) => {
    if (!userId) { reject(Error('Uploading file failed', { cause: 'No user id found' })); }
    if (!file || !importEmail) { reject(Error('Uploading file failed', { cause: 'Import e-mail address and file to import are required' })); }
    axios.post(`https://docs.budgetbakers.com/upload/import-web/${importEmail}`, fs.readFileSync(file, 'utf8'), {
        headers: {
            'Content-Type': 'text/csv',
            'X-Filename': path.basename(file),
            'X-Userid': userId,
            'Flavor': 'wallet',
            'Platform': 'WebV2',                    
            'Web-Version-Code': '1.3.4'
        }
    })
        .then((res) => resolve(true))
        .catch((err) => reject(Error('Uploading file failed', { cause: JSON.stringify(err.response.data) })));
});

/**
 * Processes an uploaded file for import.
 * @param {string} fileId - Id of the uploaded import item.
 * @param {number} recordLength - Number of rows in the file, including the header row.
 * @returns {Promise<string>} Resolves with the transaction id if import was successful.
 * @throws {Error} If the import response is missing data or the import fails.
 */
const processImport = (fileId, recordLength) => new Promise((resolve, reject) => {
    client.post(`${endpoint}/trpc/imports.importRecords?batch=1`, {
        "0": {
            "json": {
                "columns": [
                    { "type": 3, "colIndex": 0 },
                    { "type": 2, "colIndex": 1 },
                    { "type": 1, "colIndex": 2 },
                    { "type": 6, "colIndex": 3 }
                ],
                "importItemId": fileId,
                "settings": {
                    "skipHeader": true,
                    "delimiter": ",",
                    "timeZone": "UTC",
                    "dateFormatterPattern": "yyyy-MM-dd'T'HH:mm:ss.SSSSSSZ",
                    "hasExpenseColumn": true,
                    "hasFeeColumn": false,
                    "firstRecord": 1,
                    "lastRecord": recordLength,
                    "lastPossibleRecord": recordLength
                }
            }
        }
    }, {        
        headers: {
            'Content-Type': 'application/json'
        }
    })  
        .then((res) => {
            const data = res.data[0]?.result?.data?.json;
            if (!data) {
                return reject(Error('Importing process failed', { cause: `No data in response: ${JSON.stringify(res.data)}` }));
            }
            if (data.success) {
                resolve(data.data.transactionId);
            } else {
                reject(Error('Importing process failed', { cause: `Import failed: ${JSON.stringify(data)}` }));
            }            
        })
        .catch((err) => reject(Error('Importing process failed', { cause: JSON.stringify(err.response.data) })));
});

/**
 * Imports a CSV file into BudgetBakers.
 * @param {Object} params - Import parameters.
 * @param {string} params.file - Path to the CSV file to import.
 * @param {string} params.importEmail - E-mail address for the import endpoint.
 * @param {string|null} [params.accountId=null] - Optional account id used to find the uploaded import item.
 * @param {boolean} [params.newRecordsOnly=true] - Whether to rewrite the file with only records newer than the latest import.
 * @param {boolean} [params.process=true] - Whether to process the uploaded file immediately.
 * @returns {Promise<string>} Resolves with a transaction id, import item id, or up-to-date message.
 * @throws {Error} If validation, upload, or import processing fails.
 */
const importFile = async (params) => {
    const { file, importEmail, accountId = null, newRecordsOnly = true, process = true } = params;
    if (!file || !fs.existsSync(file)) { throw Error('Import failed', { cause: 'File not specified or not found' }); }
    if (!importEmail) { throw Error('Import failed', { cause: 'Import e-mail address required' }); }

    let fileContent = await fs.promises.readFile(file, 'utf8');
    if (!fileContent) { throw Error('Import failed', { cause: 'Reading file failed' }); }
    if (!fileContent.includes('date,note,income,expense')) { throw Error('Import failed', { cause: 'File data may have the wrong format' }); }
    fileContent = fileContent.split('\n');

    try {
        let imports = await getImports(accountId); 
        if (newRecordsOnly && imports.length) {
            const fileName = path.parse(imports[0].fileName).name;
            const lastIndex = fileName.lastIndexOf('-');
            const newFileName = `${fileName.substring(0, lastIndex)}:${fileName.substring(lastIndex + 1)}`;
            const lastUploadDate = new Date(newFileName).toISOString();
            fileContent = fileContent.filter(row => row == fileContent[0] || row.substring(0, 24) > lastUploadDate);
            if (fileContent.length === 1) {
                return 'Transactions up to date, file not imported';
            }
            await fs.promises.writeFile(file, fileContent.join('\n'));
        }
        const recordsLength = fileContent.length;  
        await upload(file, importEmail);
        imports = await getImports(accountId);
        if (!imports.length) {
            throw Error('Import failed', { cause: 'No imports found after upload. Please check the import e-mail address and account id' });
        }
        const fileId = imports[0]?.itemId;
        if (process) {
            const transactionId = await processImport(fileId, recordsLength);
            return transactionId;
        }
        return fileId;
    } catch (err) {
        throw Error('Import failed', { cause: err });
    }
}

export default { login, getImports, importFile }
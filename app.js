import axios from 'axios';
import { wrapper } from 'axios-cookiejar-support';
import fs from 'fs';
import path from 'path';
import qs from 'qs';
import readline from 'readline';
import { CookieJar } from 'tough-cookie';
const endpoint = 'https://web.budgetbakers.com/api';
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
        if (input.includes('https://web.budgetbakers.com/sso?ssoToken=')) {
            resolve(input.replace('https://web.budgetbakers.com/sso?ssoToken=', ''));
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
const getAuthToken = (email, ssoKey, ssoToken) => new Promise((resolve, reject) => {
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
            const token = res.data[0]?.result?.data?.json;
            if (token) {
                resolve(token);
            } else{
                reject(Error('Getting auth token failed', { cause: `No auth token in response: ${JSON.stringify(res.data)}` }));
            }
        })
        .catch((err) => reject(Error('Getting auth token failed', { cause: JSON.stringify(err.response.data) })));
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
 * @param {string} authToken - The authentication token from getAuthToken.
 * @param {string} csrfToken - The CSRF token from getCsrfToken.
 * @returns {Promise<string>} Resolves with the session token string.
 * @throws {Error} If setting the session token fails or the token cannot be extracted.
 */
const setSessionToken = async (authToken, csrfToken) => {
    try {
        const callbackUrl = (await jar.getCookies('https://web.budgetbakers.com')).find((cookie) => cookie.key.includes('callback-url'))?.value || 'https://web.budgetbakers.com';
        const sessionRes = (await client.post(`${endpoint}/auth/callback/sso`, qs.stringify({
            token: authToken,
            csrfToken,
            callbackUrl
        }), {
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
            },        
            maxRedirects: 0,
            validateStatus: (status) => status >= 200 && status < 400
        }));
        const sessionToken = sessionRes.headers['set-cookie']?.find((cookie) => cookie.startsWith('__Secure-next-auth.session-token='))?.split(';')[0].split('=')[1]; 
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
 * Retrieves the user id from BudgetBakers API
 * @returns {Promise<string>} The user id
 * @throws {Error} If retrieving user id fails
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
 * Authenticates user with BudgetBakers API
 * @param {string} email - The e-mail address to use for login.
 * @param {string|null} sessionToken - Optional existing session token to reuse.
 * @returns {Promise<{sessionToken: string, userId: string}>} Resolves with sessionToken and userId after successful authentication.
 * @throws {Error} If credentials are missing or login process fails.
 */
const login = async (email, sessionToken = null) => {
    if (!email) { throw Error('Login failed', { cause: 'E-mail address is required' }); }
    try {
        if (sessionToken) {
            await jar.setCookie(`__Secure-next-auth.session-token=${sessionToken}; Path=/; Secure; HttpOnly; SameSite=Lax`, 'https://web.budgetbakers.com');
            userId = await getUserId();
            return { sessionToken, userId };
        }
        const ssoKey = await requestLogin(email);
        const ssoToken = await requestSsoToken();
        const authToken = await getAuthToken(email, ssoKey, ssoToken);
        const csrfToken = await getCsrfToken();
        userId = await getUserId();
        sessionToken = await setSessionToken(authToken, csrfToken);
        return { sessionToken, userId };
    } catch (err) {
        throw Error('Login failed', { cause: err });
    }
}

/**
 * Gets all imported files from BudgetBakers API
 * @param {string|null} accountId - Optional account id to filter imports
 * @returns {Promise<Array>} Array of imported files
 * @throws {Error} If not logged in or retrieval fails
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
 * Uploads a file to BudgetBakers import system
 * @param {string} file - Path to the file to upload
 * @param {string} importEmail - Email address associated with the import
 * @returns {Promise<boolean>} True if upload successful
 * @throws {Error} If login required or upload fails
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
 * Processes an uploaded file for import
 * @param {string} fileId - id of the uploaded file
 * @param {number} recordLength - Number of records in the file
 * @returns {Promise<string>} Resolves with the transaction id if import was successful.
 * @throws {Error} If not logged in or import fails
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
 * Main function to handle the complete import process
 * @param {Object} params - Import parameters
 * @param {string} params.file - Path to the file to import
 * @param {string} params.importEmail - Email address for import
 * @param {string|null} params.accountId - Optional account id
 * @param {boolean} params.newRecordsOnly - Whether to import only new records
 * @returns {Promise<string>} Success message
 * @throws {Error} If import process fails
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
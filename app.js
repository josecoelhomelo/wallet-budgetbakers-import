import fs from 'fs';
import path from 'path';
import axios from 'axios';
import protobuf from 'protobufjs';
const proto = await protobuf.load('messages.proto');   
const endpoint = 'https://api.budgetbakers.com';
let cookie, userId;

/**
 * Authenticates user with BudgetBakers API
 * @param {string} user - The username/email for authentication
 * @param {string} password - The password for authentication
 * @returns {Promise<string>} The user ID after successful authentication
 * @throws {Error} If credentials are missing or login fails
 */
const login = async (user, password) => {
    if (!user || !password) { throw Error('Credentials are required'); }
    try {
        const loginData = await axios.post(`${endpoint}/auth/authenticate/userpass`, {
            username: user,
            password: password,
        }, {        
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
        });
        cookie = loginData.headers['set-cookie'];
        userId = await getUserId();
        return userId;
    } catch (err) {
        throw Error('Login failed', { cause: err });
    }
}

/**
 * Retrieves the user ID from BudgetBakers API
 * @returns {Promise<string>} The user ID
 * @throws {Error} If retrieving user ID fails
 */
const getUserId = () => new Promise((resolve, reject) => {
    axios.get(`${endpoint}/ribeez/user/abc`, {
        headers: {
            'Cookie': cookie,
            'Flavor': 0,
            'Platform': 'web',                    
            'Web-Version-Code': '4.18.13'
        },
        responseType: 'arraybuffer'
    })
        .then((res) => {
            const user = proto.lookupType("budgetbakers.User");
            const message = user.decode(new Uint8Array(res.data));
            const userId = user.toObject(message).id;
            resolve(userId);
        })
        .catch((err) => reject(Error('Retrieving user identification failed', { cause: err })));
});

/**
 * Gets all imported files from BudgetBakers API
 * @param {string|null} accountId - Optional account ID to filter imports
 * @returns {Promise<Array>} Array of imported files
 * @throws {Error} If not logged in or retrieval fails
 */
const getImports = (accountId = null) => new Promise((resolve, reject) => {    
    if (!cookie) { reject(Error('Login required')); }
    axios.get(`${endpoint}/ribeez/import/v1/all`, {
        headers: {
            'Cookie': cookie,
            'Flavor': 0,
            'Platform': 'web',                    
            'Web-Version-Code': '4.18.13'
        },
        responseType: 'arraybuffer'
    })
        .then((res) => {
            const imports = proto.lookupType("budgetbakers.Imports")
            const message = imports.decode(new Uint8Array(res.data));
            let files = imports.toObject(message).files;
            if (accountId) { return resolve(files.filter(file => file.accountId == accountId)); }
            resolve(files);
        })
        .catch((err) => reject(Error('Retrieving imported files failed', { cause: err })));
});

/**
 * Uploads a file to BudgetBakers import system
 * @param {string} file - Path to the file to upload
 * @param {string} email - Email address associated with the import
 * @returns {Promise<boolean>} True if upload successful
 * @throws {Error} If login required or upload fails
 */
const upload = (file, email) => new Promise((resolve, reject) => {
    if (!userId) { reject(Error('Login required')); }    
    if (!file || !email) { reject(Error('Import e-mail address and file to import are required')); }
    axios.post(`https://docs.budgetbakers.com/upload/import-web/${email}`, fs.readFileSync(file, 'utf8'), {
        headers: {
            'Content-Type': 'text/csv',
            'x-filename': path.basename(file),
            'x-userid': userId,
            'Flavor': 0,
            'Platform': 'web',                    
            'Web-Version-Code': '4.18.13'
        }
    })
        .then((res) => resolve(true))
        .catch((err) => reject(Error('Uploading file failed', { cause: err })));
});

/**
 * Processes an uploaded file for import
 * @param {string} fileId - ID of the uploaded file
 * @param {number} fileLength - Number of records in the file
 * @returns {Promise<boolean>} True if import successful
 * @throws {Error} If not logged in or import fails
 */
const makeImport = (fileId, fileLength) => new Promise((resolve, reject) => {
    if (!cookie || !userId) { reject(Error('Login required')); }
    if (!fileId || !fileLength) { reject(Error('File identification and length are required')); }
    const timestamp = proto.lookupType('budgetbakers.Timestamp');            
    const payload = {
        unknown: [
            { id: 3, id2: 0 },
            { id: 2, id2: 1 },
            { id: 1, id2: 2 },
            { id: 6, id2: 3 }
        ],
        format: [{
            id: 1,
            id2: fileLength,
            id3: 1,
            id4: ',',
            id5: 'UTC',
            id6: fileLength,
            id7: `yyyy-MM-dd'T'HH:mm:ss.SSSSSSZ`
        }]
    };          
    const timestampMessage = timestamp.create(payload);            
    const buffer = timestamp.encode(timestampMessage).finish();
    axios.post(`${endpoint}/ribeez/import/v1/item/${fileId}/records`, buffer, {
        headers: {
            'Cookie': cookie,
            'Content-Type': 'application/x-protobuf',
            'Flavor': 0,
            'Platform': 'web',                    
            'Web-Version-Code': '4.18.13'
        },
    })
        .then((res) => resolve(true))
        .catch((err) => reject(Error('Importing process failed', { cause: err })));
});

/**
 * Main function to handle the complete import process
 * @param {Object} params - Import parameters
 * @param {string} params.file - Path to the file to import
 * @param {string} params.email - Email address for import
 * @param {string|null} params.accountId - Optional account ID
 * @param {boolean} params.newRecordsOnly - Whether to import only new records
 * @returns {Promise<string>} Success message
 * @throws {Error} If import process fails
 */
const importFile = async (params) => {
    const { file, email, accountId = null, newRecordsOnly = true } = params;
    if (!file || !fs.existsSync(file)) { throw Error('File not specified or not found'); }
    if (!email) { throw Error('Import e-mail address required'); }    

    let fileContent = (await fs.promises.readFile(file, 'utf8')).split('\n');
    if (!fileContent) { throw Error(`Reading file failed`); }
    if (!fileContent.includes('date,note,amount,expense')) { throw Error('File data may have wrong format'); }

    try {
        let imports = await getImports(accountId);
        if (imports[0] && newRecordsOnly) {
            const fileName = path.parse(imports[0].fileName).name;
            const lastIndex = fileName.lastIndexOf('-');
            const newFileName = `${fileName.substring(0, lastIndex)}:${fileName.substring(lastIndex + 1)}`;
            const lastUploadDate = new Date(newFileName).toISOString();
            fileContent = fileContent.filter(row => row == fileContent[0] || row.substring(0,24) > lastUploadDate);      
            if (fileContent.length === 1) { return 'Transactions up to date, file not imported'; }    
            await fs.promises.writeFile(file, fileContent.join('\n'));
        }        
        const fileLength = fileContent.length;  
        await upload(file, email);
        imports = await getImports(accountId);
        const fileId = imports[0]?.id;
        await makeImport(fileId, fileLength);
        return 'File imported successfully';
    } catch (err) {
        throw Error('Import failed', { cause: err });
    }
}

export default { login, getImports, importFile }
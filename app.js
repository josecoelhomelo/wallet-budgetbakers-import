const fs = require('node:fs');
const path = require('node:path');
const axios = require('axios');
const qs = require('qs');
const protobuf = require('protobufjs');

const uploadFile = (email, password, file, checkDate = false) => new Promise(async (resolve, reject) => {
    if (!email || !password) { return reject('Credentials required'); }
    if (!file || !fs.existsSync(file)) { return reject('File not specified or not found'); }

    const fileContent = await fs.promises.readFile(file, 'utf8');
    if (!fileContent) { return reject(`Can't read file`); }
    if (!fileContent.includes('date,note,amount,expense')) { return reject('File data may have wrong format'); }   

    const api = 'https://api.budgetbakers.com';    
    const proto = await protobuf.load('messages.proto');  
    let userID, cookie;

    axios.post(`${api}/auth/authenticate/userpass`, qs.stringify({
            username: email,
            password: password,
        }), {            
            headers: {
                'content-type': 'application/x-www-form-urlencoded',
            }
        })
        .catch(err => reject('Login failed'))
        .then(res => {
            cookie = res.headers['set-cookie'];

            return axios.get(`${api}/ribeez/user/abc`, {
                headers: {
                    'cookie': cookie,
                    'flavor': 0,
                    'platform': 'web',                    
                    'web-version-code': '4.9.0'
                },
                responseType: 'arraybuffer'
            });                        
        })
        .catch(err => reject('Retrieving user information failed'))
        .then(res => {
            const user = proto.lookupType("budgetbakers.User")
            const message = user.decode(new Uint8Array(res.data));
            userID = user.toObject(message).id;

            return axios.get(`${api}/ribeez/import/v1/all`, {
                headers: {
                    'cookie': cookie,
                    'flavor': 0,
                    'platform': 'web',                    
                    'web-version-code': '4.9.0'
                },
                responseType: 'arraybuffer'
            });                    
        })
        .catch(err => reject('Retrieving imports failed'))  
        .then(res => {
            const imports = proto.lookupType("budgetbakers.Imports")
            const message = imports.decode(new Uint8Array(res.data));
            const lastFile = imports.toObject(message).files[0];

            if (lastFile && checkDate) { 
                const fileName = lastFile.fileName.slice(0, -4);
                const lastIndex = fileName.lastIndexOf('-');
                const newFileName = `${fileName.substring(0, lastIndex)}:${fileName.substring(lastIndex + 1)}`;
                const lastUploadDate = Date.parse(newFileName);

                if (!lastUploadDate) {
                    console.warn(`Couldn't read last uploaded date`);
                    return;
                }

                const data = fileContent.split('\n');
                const newData = ['date,note,amount,expense'];
                let newDataChanged = false;
            
                data.forEach(row => {          
                    if (Date.parse(row.substring(0, 16)) >= lastUploadDate) {
                        newData.push(row);
                        newDataChanged = true;
                    }
                });
        
                if (!newDataChanged) {
                    return resolve('Transactions up to date, file not imported');
                }
        
                fs.writeFileSync(file, newData.join('\n'), err => {
                    return reject('Error rewriting file');
                });
            }
                        
            return axios.post('https://docs.budgetbakers.com/upload/import-web/fhfxoy@imports.budgetbakers.com', fs.readFileSync(file, 'utf8'), {
                headers: {
                    'content-type': 'text/csv',
                    'flavor': '0',
                    'platform': 'web',
                    'web-version-code': '4.9.0',
                    'x-filename': path.basename(file),
                    'x-userid': userID
                }
            });
        }) 
        .catch(err => reject('Uploading file failed'))  
        .then(res => {               
            return axios.get(`${api}/ribeez/import/v1/all`, {
                headers: {
                    'cookie': cookie,
                    'flavor': 0,
                    'platform': 'web',                    
                    'web-version-code': '4.9.0'
                },
                responseType: 'arraybuffer'
            });           
        })
        .catch(err => reject('Retrieving uploaded file failed'))
        .then(res => {
            const imports = proto.lookupType("budgetbakers.Imports")
            const importsMessage = imports.decode(new Uint8Array(res.data));
            const uploadedFile = imports.toObject(importsMessage).files[0];
            
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
                    id2: 2,
                    id3: 1,
                    id4: ',',
                    id5: 'UTC',
                    id6: 2,
                    id7: `yyyy-MM-dd'T'HH:mm:ss.SSSSSSZ`
                }]
            };          
            const timestampMessage = timestamp.create(payload);            
            const buffer = timestamp.encode(timestampMessage).finish();  

            return axios.post(`${api}/ribeez/import/v1/item/${uploadedFile.id}/records`, buffer, {
                headers: {
                    'cookie': cookie,
                    'flavor': '0',
                    'platform': 'web',
                    'web-version-code': '4.9.0',
                    'content-type': 'application/x-protobuf'
                },
            }); 
        })
        .catch(err => reject('Importing file failed'))
        .then(res => resolve('File successfully imported'));
});

module.exports = {
    uploadFile
};
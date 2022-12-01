const fs = require('node:fs');
const puppeteer = require('puppeteer');

const uploadFile = (email, password, file, checkDate = false) => new Promise(async (resolve, reject) => {
    if (!email || !password) { return reject('Credentials required'); }
    if (!file || !fs.existsSync(file)) { return reject('File not specified or not found'); }

    const fileContent = await fs.promises.readFile(file, 'utf8');
    if (!fileContent) { return reject(`Can't read file`); }
    if (!fileContent.includes('date,note,amount')){ return reject('File data may have wrong format'); }   
        
    const browser = await puppeteer.launch({headless: false});
    const page = await browser.newPage();
    await page.goto('https://web.budgetbakers.com');

    await page.waitForSelector('form');    
    await page.evaluate(email => { document.querySelector('input[name=email]').value = email }, email);
    await page.type('input[name=email]', '.');
    await page.keyboard.press('Backspace');
    await page.evaluate(password => { document.querySelector('input[name=password]').value = password }, password);
    await page.type('input[name=password]', '.');
    await page.keyboard.press('Backspace');
    await page.waitForTimeout(500);
    await page.evaluate(() => { document.querySelector('button[type=submit]').click() });

    await (await page.waitForSelector('a[href="/imports"]')).click();
    await page.waitForSelector('.files-dropzone');

    if (checkDate) { 
        const lastUploadDate = await page.evaluate(() => {
            if (document.querySelector('.items-container ul')) {
                const fileName = document.querySelector('.items-container li:first-of-type .name').innerText.slice(0, -4);
                const lastIndex = fileName.lastIndexOf('-');
                const newFileName = `${fileName.substring(0, lastIndex)}:${fileName.substring(lastIndex + 1)}`;
                return Date.parse(newFileName);
            }
        });

        if (!lastUploadDate) {
            console.warn(`Couldn't read last uploaded date`);
            return;
        }

        const data = fileContent.split('\n');
        let newData = ['date,note,amount'];
        let newDataChanged = false;
    
        data.forEach(row => {          
            if (Date.parse(row.substring(0, 16)) > lastUploadDate) {
                newData.push(row);
                newDataChanged = true;
            }
        });

        if (!newDataChanged) {
            browser.close();
            return resolve('Transactions up to date, file not imported');
        }

        fs.writeFileSync(file, newData.join('\n'), err => {
            browser.close();
            return reject('Error rewriting file');
        });
    }
    
    const uploadInput = await page.waitForSelector('input[name=file]');
    await uploadInput.uploadFile(file);     
    await (await page.waitForSelector('.modal .actions button.primary')).click();
    await browser.close();
    resolve('File successfully imported');
});

module.exports = {
    uploadFile
};
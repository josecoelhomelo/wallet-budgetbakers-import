Node.js module to import a CSV file with transactions to BudgetBakers' Wallet.

# Installation
`npm install wallet-budgetbakers-import`

# Usage

Your CSV file with transactions must have the following format (date in mm-dd-yyyy):

```csv
date,note,amount,expense
03-15-2022,Supermarket,0,1.99
03-07-2022,Income,200.00,0
```

### uploadFile
Pass the following arguments to upload a file:\
`username` - Your login username\
`password` - Your login password\
`file` - File name with its path, e.g. `path/to/file/2022-03-20T16-20.csv`
`email` - The account's import e-mail. You can find it in your account's settings\
`account id` - Optional field for the account's ID. By using this argument, the module will check if the transactions are up to date. File won't be uploaded if they are. For it to work properly make sure your file's name has the `YYYY-MM-DDTHH-MM` format, for example: `2022-03-20T16-20`

```js
const wallet = require('wallet-budgetbakers-import');
wallet.uploadFile('username', 'password', 'path/to/file/2022-03-20T16-20.csv', 'abcdef@imports.budgetbakers.com', '-Account_00000000-0000-0000-0000-000000000000').then(res => {
    console.log(res));
});
```
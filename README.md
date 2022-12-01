Node.js module to import a CSV file with transactions to BudgetBakers' Wallet.

# Installation
`npm install budgetbakers-import`

# Usage

Your CSV file with transactions must have the following format:

```csv
date,note,amount,expense
2022-03-07T16:54,Supermarket,0,-1.99
2022-02-28T19:55,Income,200.00,0
```

### uploadFile
By passing `true` in the last argument, script will check if the transactions are up to date. File won't be uploaded if they are.
For it to work properly make sure your file's name has the `YYYY-MM-DDTHH-MM` format, for example: `2022-03-08T16-20`.

```js
const budgetbakers = require('budgetbakers-import');

budgetbakers.uploadFile('username', 'password', 'path/to/file/2022-03-08T16-20.csv', true).then(res => {
    console.log(res));
});
```
Node.js module to import a CSV file with transactions to BudgetBakers' Wallet.

## Installation

Install the package using npm:

```shell
npm install wallet-budgetbakers-import
```

After installing, import it into your project:

```js
import wallet from 'wallet-budgetbakers-import';
```

## Example

Importing a CSV file:

```js
import wallet from 'wallet-budgetbakers-import';
try {
    await wallet.login('your-email@provider.com', 'YourPassword123456');
    const result = await wallet.importFile({
        file: 'path/to/file/2022-03-20T16-20.csv',
        email: 'account-email@imports.budgetbakers.com'  
    });   
    console.log(result);    
} catch(err) {
    console.error(err);
}
```

The file with transactions must have the following format (date in ISO 8601):

```csv
date,note,amount,expense
2023-03-15T10:30:00.000Z,Supermarket,0,1.99
2023-03-07T15:00:00.000Z,Income,200.00,0
```

## Methods

### `login`

Logs in with the provided credentials.

```js
wallet.login('your-email@provider.com', 'YourPassword123456');
```

### `getImports`

Retrieves an array of imported files.

```js
wallet.getImports('-Account_00000000-0000-0000-0000-000000000000');
```

By providing an account identification, the result will be filtered accordingly. The id can be found in the URL, when navigating to the account detail, in Wallet's web app.

### `importFile`

Imports an CSV file.

```js
wallet.importFile({
    file: 'path/to/file/2022-03-20T16-20.csv',
    email: 'account-email@imports.budgetbakers.com',
    accountId: '-Account_00000000-0000-0000-0000-000000000000',
    newRecordsOnly: false,
    processImport: true
}); 
```

The following is a list of the available configuration values:

| Property | Definition |
| -------- | ---------- |
| `file` | Path to the file to import |
| `email` | Account's import e-mail. You can find it in your account's settings |
| `accountId` | Optional; specifies to which account the transactions will be imported |
| `newRecordsOnly` | Defaults to `true`; only new transactions will be imported. For it to work properly, make sure your file's name has the `YYYY-MM-DDTHH-MM` format, for example: `2022-03-20T16-20` |
| `processImport` | Defaults to `true`; this should be set to `false` if you have "Automatic Imports" enabled in your Wallet account settings. 


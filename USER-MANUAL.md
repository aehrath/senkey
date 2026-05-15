# SenKey User Manual

This guide explains how to use the installed SenKey extension using only the controls visible in the popup.

## Initial setup

Before SenKey can save or fill credentials, complete this one-time setup:

1. Click the SenKey icon in your browser toolbar.
2. Click `⚙`.
3. In `Google Account`, click `Sign in with Google`.
4. Complete the Google sign-in window.
5. In `Server Configuration`, enter `API URL`.
6. Enter `API Key`.
7. Click `Save Settings`.

After this is done, SenKey is ready to fetch, save, and fill your credentials.

## What you see in the popup

The top of the popup shows:

- the SenKey name
- the current version
- the main tabs
- a `Help` button

The main tabs are:

- `Fill`
- `Add`
- `⚙`

## Fill tab

The `Fill` tab shows:

- the current website
- your saved credentials for that site

Each credential appears as a card with:

- the website icon
- the saved domain
- a `▶` fill button
- a `✎` edit button
- a `✕` delete button

### Fill a credential

Click either:

- the credential card
- the `▶` button

SenKey will either:

- fill the current login page, or
- open the saved login page and fill there

If the fill succeeds, SenKey shows `✓ Filled!`

### Edit a credential

Click `✎`.

SenKey switches to the `Add` tab and opens the credential in update mode with the current values already filled in.

### Delete a credential

Click `✕`.

If deletion succeeds, SenKey shows `Deleted`.

### Messages you may see

- `Loading...`
- `Fetching from server...`
- `No credentials saved yet. Use the Add tab to add one.`

## Add tab

Use the `Add` tab to save a new credential or update an existing one.

Visible fields:

- `Domain`
- `Username / Email`
- `Password`
- `Login URL`

Visible buttons:

- `Save to Server`
- `Update Credential` while editing
- `Cancel` while editing
- `👁` next to the password field

### Save a new credential

1. Open `Add`.
2. Enter the site in `Domain`.
3. Enter your username or email.
4. Enter your password.
5. Optionally keep or change `Login URL`.
6. Click `Save to Server`.

If save succeeds, SenKey shows `✓ Saved to server`.

### Update an existing credential

1. Start from `Fill`.
2. Click `✎` on a saved credential.
3. Edit the fields you want to change.
4. Click `Update Credential`.

If the update succeeds, SenKey shows `✓ Credential updated`.

### Cancel an edit

If you opened a credential in update mode, click `Cancel` to leave edit mode.

### Show or hide the password

Click the `👁` button next to the password field.

## Settings tab

Use the `⚙` tab to manage sign-in, server settings, and encryption keys.

### Google Account

If you are signed out, you will see:

- `Sign in with Google`

If you are signed in, you will see:

- your profile initial
- your name
- your email
- a `✕` sign-out button

#### Sign in

1. Click `Sign in with Google`.
2. Complete the Google sign-in window.

If sign-in succeeds, SenKey shows `✓ Signed in as ...`

If Brave shows a `400 invalid_request` Google sign-in error, open
`brave://settings/extensions`, enable `Allow Google login for extensions`, then
sign into Google in a normal Brave tab, reload SenKey, and try signing in again.
Brave says the extension login setting has no effect when the browser is not
logged into Google.

#### Sign out

1. Open `⚙`.
2. Click the `✕` button in the Google account card.

If sign-out succeeds, SenKey shows `Signed out`.

### Server Configuration

Visible fields:

- `API URL`
- `API Key`

Visible buttons:

- `👁` next to the API key field
- `Save Settings`

#### Save server settings

1. Enter your backend address in `API URL`.
2. Enter your shared key in `API Key`.
3. Click `Save Settings`.

If save succeeds, SenKey shows `✓ Settings saved`.

### Encryption Keys

Visible controls:

- `Export Keys`
- `Import Keys`

#### Export keys

Click `Export Keys` to save your SenKey encryption keys to a file.

These exported keys are extremely important:

- SenKey uses them to decrypt your saved passwords
- you need them if you want to use the same encrypted data on another browser profile or device
- if these keys are lost and your browser storage is gone, you may not be able to recover your saved passwords

Keep the exported key file private and safe.
Do not share it.
Anyone with this file may be able to read the passwords protected by it.

#### Import keys

1. Click `Import Keys`.
2. Choose a previously exported SenKey key file.

If import succeeds, SenKey shows `✓ Keys imported`.

## Help button

Click `Help` in the popup header to reopen the built-in SenKey help page at any time.

SenKey also opens the help page automatically after install and after updates.

## Messages you may see

Common success messages:

- `✓ Filled!`
- `✓ Saved to server`
- `✓ Credential updated`
- `✓ Settings saved`
- `✓ Keys imported`
- `Keys exported`
- `Deleted`
- `Signed out`
- `Opening and filling ...`
- `Updated saved login URL`

Common error messages:

- `All fields are required`
- `Login URL is invalid`
- `API URL is required`
- `Invalid server URL`
- `No active tab`
- `Cannot fill on this page`
- `No fields found ...`

## Typical daily use

1. Open the site you want to sign in to.
2. Open SenKey.
3. In `Fill`, click the matching credential.
4. If you need to save a new login, use `Add`.
5. If you need to change a password later, use `✎` from `Fill`.

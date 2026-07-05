# SenKey User Manual

Current version: `1.4.0`

This guide explains how to use the installed SenKey extension using only the controls visible in the popup.

## Initial setup

Before SenKey can save or fill credentials, complete this one-time setup:

1. Click the SenKey icon in your browser toolbar.
2. Click `⚙`.
3. In `Google Account`, click `Sign In With Google`.
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
- `Help`

## Fill tab

The `Fill` tab shows your saved credentials list.

Each credential appears as a card with:

- the website icon
- the saved domain
- a `▶` fill button
- a `✎` edit button
- a `✕` delete button

### Folders

Credentials can be grouped into folders. Folders can be nested using `/` (for example, `Work/Clients`). Folders are collapsible, and their collapsed or expanded state is remembered between sessions.

Folder paths are saved with your credentials in the SenKey bucket, so they
follow the signed-in Google user across browsers.

Click `✎` on a folder header to rename that folder path. If you rename it to an
existing folder path, SenKey automatically merges the credentials into that
existing folder.

### Fill a credential

Click either:

- the credential card
- the `▶` button

SenKey will either:

- fill the current login page, or
- open the saved login page and fill there

When the current tab is already a saved login page, SenKey briefly shows an
`Active` fill button at the top of the credential list.

If the fill succeeds, SenKey shows `✓ Filled!`

### Edit a credential

Click `✎`.

SenKey switches to the `Add` tab and opens the credential in update mode with the current values already filled in.

### Delete a credential

Click `✕`.

If deletion succeeds, SenKey shows `Deleted`.

### Messages you may see

- `Loading…`
- `Fetching from server…`
- `No credentials saved yet. Use the Add tab to add one.`

## Add tab

Use the `Add` tab to save a new credential or update an existing one.

Visible fields:

- `Domain`
- `Username / Email`
- `Password`
- `Login URL`
- `Folder`

Visible buttons:

- `Save To Server`
- `Update Credential` while editing
- `Cancel` while editing
- `↻` next to the password field to suggest a secure password
- `👁` next to the password field

The `Folder` field groups the credential under a named folder in the `Fill` tab. Use `/` for nesting (for example, `Work/Clients`). Existing folder names are suggested as you type.

### Save a new credential

1. Open `Add`.
2. Enter the site in `Domain`.
3. Enter your username or email.
4. Enter your password, or click `↻` to suggest a secure password.
5. Optionally keep or change `Login URL`.
6. Click `Save To Server`.

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

### Suggest a secure password

Click the `↻` button next to the password field to fill a new 20-character
password suggestion. The suggestion is generated locally in the extension. It
is saved and encrypted only when you click `Save To Server` or
`Update Credential`.

## Settings tab

Use the `⚙` tab to manage sign-in, server settings, encryption keys, and login page backups.

### Google Account

If you are signed out, you will see:

- `Sign In With Google`

If you are signed in, you will see:

- your profile initial
- your name
- your email
- a `✕` sign-out button

#### Sign in

1. Click `Sign In With Google`.
2. Complete the Google sign-in window.

If sign-in succeeds, SenKey shows `✓ Signed in as …`

Brave users should also enable `brave://settings/extensions` > `Allow Google
login for extensions`, then sign into Google in a normal Brave tab before
signing into SenKey.

If you are testing an unpacked custom build, run `./build.sh` and load `dist/`.
Dev builds show a `DEV` badge on the extension logo so they are easy to tell
apart from the published build. The OAuth client IDs in `.env` must match that
installed extension ID.
If Google shows `redirect_uri_mismatch`, the Web application OAuth client used
for Brave fallback is missing the exact
`https://<extension-id>.chromiumapp.org/oauth2` redirect URI, or the extension
was built with the wrong OAuth client type.

#### Sign Out

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

### Login Pages

Visible controls:

- `Export Login Pages`
- `Import Login Pages`

#### Export login pages

Click `Export Login Pages` to download a JSON backup of the browser login page list.
SenKey also tries to save the same backup to the bucket document that stores your
credentials and credential folder paths. If the bucket save fails, the local JSON
download still completes and SenKey shows the bucket error.

#### Import login pages

Click `Import Login Pages` and choose a login page JSON backup. SenKey replaces the
bucket login page backup with that file and restores the imported tree into a new
browser folder.

Existing login pages are not deleted or overwritten.

If import succeeds, SenKey shows `✓ Login Pages imported`.

If login pages change while the popup is open, SenKey saves the updated login page
tree to the bucket automatically and tries one last save when the popup closes.

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
- `Login Pages exported`
- `Downloaded backup. Bucket save failed: …`
- `✓ Login Pages imported`
- `✓ Folder renamed`
- `Deleted`
- `Signed out`
- `Opening and filling …`
- `Updated saved login URL`
- `Secure password suggested`

Common error messages:

- `All fields are required`
- `Login URL is invalid`
- `API URL is required`
- `Invalid server URL`
- `No active tab`
- `Cannot fill on this page`
- `No fields found …`
- `Cannot move a folder inside itself`
- `Server error 400: …`

## Typical daily use

1. Open the site you want to sign in to.
2. Open SenKey.
3. In `Fill`, click the matching credential.
4. If you need to save a new login, use `Add`.
5. If you need to change a password later, use `✎` from `Fill`.

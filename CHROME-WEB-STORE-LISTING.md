# SenKey Chrome Web Store Listing

Current version: `1.4.1`

Use the text below for the Chrome Web Store listing. It is written to match the current SenKey feature set and deployment model.

## Extension name

SenKey

## Short description

Store and autofill passwords from your own backend with Google sign-in and client-side encryption.

## Detailed description

SenKey is a self-hosted password storage and autofill extension for Chrome and other Chromium-based browsers.

Instead of locking your credentials into a third-party password manager service, SenKey lets you keep control of your own backend while still giving you a fast, practical browser autofill experience.

SenKey is built for people and teams who want:

- their own server or cloud backend
- Google-account-based user separation
- client-side password encryption before upload
- saved login URLs for reopening the correct sign-in page later
- folder organization with rename and merge support
- Login Pages import/export from the Settings tab
- a lightweight, focused password fill workflow

How SenKey works:

1. You sign in to the extension with Google.
2. You connect the extension to your own SenKey backend with an API URL and API key.
3. When you save a credential, SenKey encrypts the password in the browser before it is uploaded.
4. SenKey stores credentials per signed-in Google user on your backend.
5. When you click a saved credential, SenKey can fill the current login page or navigate to the saved login page and autofill there.

Key features:

- Self-hosted credential storage
  Use your own backend instead of relying on a hosted password vault service.

- Client-side password encryption
  Passwords are encrypted in the extension before they are sent to the server.

- Google sign-in
  SenKey uses Google sign-in to separate data by user.

- Login URL memory
  SenKey can save the full login page URL, not just a domain, so it can reopen the correct sign-in page later.

- Navigation plus autofill
  If you are not already on the right login page, SenKey can open the saved login page and autofill after navigation.

- Folder organization
  Credentials can be assigned to folders so related logins stay grouped and easy to find. Folder paths can be renamed, and renaming to an existing folder merges the contents automatically.

- Support for modern login flows
  SenKey includes logic for many standard, SPA, shadow DOM, and multi-step login forms.

- Credential editing
  Update usernames, passwords, domains, folders, and saved login URLs directly from the popup.

- Built-in help
  The extension includes a built-in help page for setup and daily use.

- Login Pages import and export
  Export browser login pages to a JSON file and the user's configured SenKey
  bucket document, or import a JSON backup and replace the bucket backup.

Who SenKey is for:

- developers who want to host their own password backend
- small teams who want a lightweight private credential workflow
- users who prefer a simple extension backed by infrastructure they control

Important note:

SenKey is not a zero-setup consumer password manager. It requires you to connect the extension to your own backend or a backend deployed for you. If you want complete control over where your credential data lives, that is the point.

Typical setup:

- deploy the SenKey backend to your own PHP host or Google Cloud Run
- sign in with Google inside the extension
- paste the backend API URL and API key into SenKey settings
- save credentials and use the `Fill` tab to autofill them later

SenKey is designed to stay focused:

- save credentials
- reopen the correct login page
- autofill reliably
- keep folders organized
- import and export login pages on demand
- keep your backend under your control

## Category suggestion

Productivity

## Store tags / keywords

- password manager
- self-hosted
- autofill
- login manager
- credentials
- cloud run
- php backend
- secure storage

## Single purpose statement

SenKey stores encrypted website credentials on a user-controlled backend, autofills them on login pages, and provides user-initiated Login Pages import/export.

## Permissions justification

### `identity`

Used for Google sign-in so SenKey can separate stored credentials by signed-in user.

### `storage`

Used to save extension settings, local encryption keys, collapsed folder state,
login URL overrides, lightweight local extension state, and short-lived retry
state for folder updates. Folder paths for saved credentials are stored with the
user's encrypted credential records on the configured backend.

### `activeTab`

Used to interact with the currently open page when the user asks SenKey to autofill a credential.

### `scripting`

Used to inject autofill logic into the current page after the user selects a saved credential.

### `bookmarks`

Used only when the user clicks `Export Login Pages` or `Import Login Pages` in
Settings, or when login page changes made while the popup is open are saved on
popup close. Backups are stored in the same user bucket document as credentials
and credential folder paths when bucket save succeeds. Exports also create a
local JSON download. Imports add login pages into a new browser folder.

### Host permissions: `https://*/*` and `http://*/*`

Used only so SenKey can fill login forms on sites the user chooses to use with the extension.

## Privacy disclosure draft

SenKey is designed so the user controls the backend that stores credential data.

What SenKey handles:

- Google account identity for user sign-in
- backend API URL and API key entered by the user
- encrypted credential records stored on the user's chosen backend
- local encryption keys stored in the browser profile
- login page data imported from or exported to the user's configured backend when
  the user clicks the login page backup controls, login page JSON files downloaded
  by the user, plus login page changes saved when the popup closes

What SenKey does not do:

- SenKey does not run a shared hosted credential storage service
- SenKey does not require sending plaintext passwords to a SenKey-operated cloud service
- SenKey does not send login page backups to any SenKey-operated service

## Support URL suggestion

[https://github.com/aehrath/senkey](https://github.com/aehrath/senkey)

## Homepage URL suggestion

[https://github.com/aehrath/senkey](https://github.com/aehrath/senkey)

## Promotional text ideas

### Option 1

Control your own credential backend without giving up browser autofill convenience.

### Option 2

Self-hosted password autofill with Google sign-in, encrypted storage, and saved login pages.

### Option 3

Your backend. Your credentials. Fast login autofill in Chrome.

## Screenshot ideas

1. Fill tab showing saved credentials grouped by folder
2. Add tab with `Domain`, `Username / Email`, `Password`, `Login URL`, and `Folder` fields
3. Settings tab with Google sign-in and server configuration
4. Login Pages and encryption backup controls in Settings
5. Built-in Help page
6. A before-and-after autofill example on a login page

## Submission notes

- Make sure the published extension uses the intended OAuth client ID.
- Confirm the help page and settings text match the final store copy.
- Keep the screenshots focused on visible user-facing features, not backend code or deployment scripts.

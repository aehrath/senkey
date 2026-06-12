# SenKey

SenKey is a Chromium extension that stores and autofills credentials from your own backend instead of a third-party password manager.

It is built around five ideas:

- credentials are encrypted in the extension before upload
- each Google user gets a separate credential store
- saved entries can remember a full login page URL, not just a domain
- you can run the backend on simple PHP hosting or on Google Cloud Run
- credential folders and login page backups are stored in the signed-in user's bucket document

## What SenKey does

- Saves credentials to your own backend
- Encrypts passwords in the extension before upload
- Autofills many standard, SPA, shadow DOM, and multi-step login forms
- Stores a login URL so a credential can reopen the correct sign-in page later
- Can navigate to a saved login page and autofill after the page loads
- Keeps data separated by signed-in Google user
- Groups credentials in folders that can be renamed or merged
- Imports and exports browser login page backups from Settings

## Project layout

```text
senkey/
├── extension/          Chrome extension source
├── docker/             Google Cloud Run backend
├── build.sh            Extension build script
├── deploy.sh           Repo-root Cloud Run deploy wrapper
├── package-deploy.sh   Creates a backend-only shareable bundle
├── USER-MANUAL.md      User-facing extension manual
└── README.md
```

## Choose a backend

SenKey supports two backend options:

- Self-hosted PHP (`credentials.php`)
  Best when you already have PHP hosting and want the simplest possible server setup. This is a separate optional component not included in this repository — see [Self-Hosted PHP Deployment](#self-hosted-php-deployment) below.
- `docker/`
  Best when you want a managed Google Cloud Run deployment with Google Cloud Storage.

## Quick Start

The usual setup is Cloud Run backend first, then extension settings:

If you do not want to clone the full repository, download the backend-only
deployment bundle:
[senkey-deploy.zip](https://drive.google.com/file/d/1JP2zc87otL8IQrM8A0HCQ4mAjK5GF95S/view?usp=drive_link).

1. Copy the environment file:

```bash
cp .env.example .env
```

2. Fill in:

- `PROJECT_ID`
- `REGION` if you do not want the default `us-west1`
- `API_KEY`, or leave it blank so `./deploy.sh` generates one automatically
- `CHROME_EXTENSION_ID` only for custom extension builds

3. Deploy the Cloud Run backend:

```bash
./deploy.sh
```

4. Build the extension only if you are developing or loading an unpacked copy:

```bash
./build.sh
```

5. Or build the Chrome Web Store upload zip when publishing:

```bash
./build.sh prod
```

6. In the extension `⚙` tab, paste:

- the `API URL` printed by `./deploy.sh`
- the same `API Key`

## Cloud Run Deployment

`deploy.sh` at the repo root is the standard deployment entry point. It runs `docker/deploy.sh` for you.

What the deploy script does:

- enables the required Google Cloud APIs
- creates or reuses the Cloud Run service `senkey-api`
- creates or reuses the storage bucket `${PROJECT_ID}-senkey`
- creates or reuses the Artifact Registry repository `senkey`
- builds the backend image with Cloud Build
- sets `API_KEY`, `GCS_BUCKET`, and the Google OAuth client allow-list on Cloud
  Run
- prints the final service URL and API key

SenKey builds and deploys a container image instead of using Cloud Run source
deploys. User data is stored only in `${PROJECT_ID}-senkey`.

What you set manually in `.env`:

- `PROJECT_ID`
- `REGION` if you do not want the default
- `CHROME_EXTENSION_ID` only for custom extension builds
- `API_KEY` if you want to choose your own shared key
- `GOOGLE_OAUTH_CLIENT_IDS` only if you want to override the backend's
  accepted Google OAuth client IDs

What is automatic:

- `GCS_BUCKET`
- bucket creation
- Artifact Registry repository creation
- API enablement
- `API_KEY` generation if the field is blank
- `GOOGLE_OAUTH_CLIENT_IDS`: the deploy script uses the published SenKey OAuth
  IDs for the published extension, or derives the allow-list from the custom
  OAuth client IDs in `.env`

You do not need to add `GCS_BUCKET` manually to `.env`.

Detailed Cloud Run docs live in:

- `docker/README.md`
- `docker/INSTALL.md`

## Self-Hosted PHP Deployment

A lightweight single-file PHP backend (`credentials.php`) is available as a separate optional component not included in this repository. It stores one JSON file per Google user and supports credential `GET`, `POST`, and `DELETE` requests.

The Cloud Run backend in this repository is the reference implementation for
the full current API, including bucket-backed credential folders and login page
backup import/export.

Basic setup:

1. Set the API key in the environment or in the script.
2. Upload the file to an HTTPS-enabled PHP host.
3. Make sure the directory is writable so per-user JSON files can be created.
4. Point the extension `API URL` to that endpoint.

## Google OAuth Setup

Published SenKey users do not need to create Google OAuth clients. The published
extension already includes the correct client ID. Deploy a backend, then paste
the backend `API URL` and `API Key` into SenKey settings.

Create OAuth clients only when you build, fork, or load your own copy of the
extension.

### OAuth Client Types

SenKey can use two Google OAuth client types. They are not interchangeable.

- `GOOGLE_OAUTH_CLIENT_ID` / `DEV_GOOGLE_OAUTH_CLIENT_ID`
  Must be a `Chrome extension` / `Chrome App` OAuth client. Its Chrome App /
  Item ID must exactly match the installed extension ID.
- `WEB_GOOGLE_OAUTH_CLIENT_ID`
  Must be a separate `Web application` OAuth client. Use it only for Brave's
  `launchWebAuthFlow` fallback.

### Custom Chrome or Edge Build

1. Run `./build.sh` once and note the `Dev extension ID` it prints.
2. In Google Cloud Console, create an OAuth client with application type
   `Chrome extension` / `Chrome App`.
3. Use the installed extension ID as the Chrome App / Item ID.
4. Put the generated client ID in `.env`:

```text
DEV_GOOGLE_OAUTH_CLIENT_ID=...
```

For production Web Store builds, use `GOOGLE_OAUTH_CLIENT_ID` instead.

### Brave Fallback Client

Brave may reject the normal Chrome Extension OAuth flow. SenKey falls back to a
web auth flow in Brave, which requires a second OAuth client.

1. In Google Cloud Console, create an OAuth client with application type
   `Web application`.
2. Add this authorized redirect URI, replacing the ID with your installed
   extension ID:

```text
https://<extension-id>.chromiumapp.org/oauth2
```

3. Put that Web client ID in `.env`:

```text
WEB_GOOGLE_OAUTH_CLIENT_ID=...
```

Do not reuse `GOOGLE_OAUTH_CLIENT_ID` here. `GOOGLE_OAUTH_CLIENT_ID` is a
Chrome Extension OAuth client and has no redirect URI settings; the fallback
requires a separate Web application OAuth client.

4. Run `./build.sh` and reload the built `dist/` extension.

### OAuth Troubleshooting

- If you use the published extension unchanged, configure only `API URL` and
  `API Key`. Do not rebuild it with your own OAuth client.
- For unpacked builds, load `dist/` after running `./build.sh`.
- The Chrome Extension OAuth client must be application type `Chrome extension`
  / `Chrome App`; its Item ID must exactly match the installed extension ID.
- The Brave fallback OAuth client must be application type `Web application`;
  its authorized redirect URI must be
  `https://<extension-id>.chromiumapp.org/oauth2`.
  For the published extension ID in this repo, that URI is
  `https://gcmgfpkabdjhniklindbjieohnfngchg.chromiumapp.org/oauth2`.
- In Brave, enable `brave://settings/extensions` > `Allow Google login for
  extensions`, and sign into Google in a normal Brave tab.
- After changing `GOOGLE_OAUTH_CLIENT_ID`, `DEV_GOOGLE_OAUTH_CLIENT_ID`, or
  `WEB_GOOGLE_OAUTH_CLIENT_ID`, run `./build.sh` and reload the extension.

Google's downloaded `client_secret_*.json` file is not used by this extension.
Only the generated OAuth client IDs belong in `.env`.

### Backend OAuth Allow-List

The backend always requires both `X-API-Key` and a Google Bearer token. The
deploy script also sets a Google token audience allow-list. You usually do not
need to fill in `GOOGLE_OAUTH_CLIENT_IDS`: for the published extension, deploy
uses SenKey's published OAuth clients; for custom full-repo builds, deploy
derives the allow-list from `GOOGLE_OAUTH_CLIENT_ID`,
`DEV_GOOGLE_OAUTH_CLIENT_ID`, and `WEB_GOOGLE_OAUTH_CLIENT_ID`. Set
`GOOGLE_OAUTH_CLIENT_IDS` only when you need to override that backend allow-list
manually, such as in a backend-only custom deployment.

## Build Commands

Use `build.sh` for extension builds.

Commands:

```bash
./build.sh
./build.sh prod
./deploy.sh
./package-deploy.sh
```

What they do:

- `./build.sh`
  Creates `dist/` for unpacked local testing. Dev builds include a stable
  manifest key from `EXTENSION_KEY`, an existing PEM key, or generated
  `extension.dev.pem`, and the generated icons include a `DEV` badge so the
  unpacked extension is visually distinct.
- `./build.sh prod`
  Creates `senkey.zip` for Chrome Web Store upload. Production builds do not
  include a manifest key or the dev icon badge.
- `./deploy.sh`
  Deploys the Cloud Run backend from the repo root.
- `./package-deploy.sh`
  Creates `senkey-deploy.zip`, a backend-only shareable bundle. A downloadable
  copy is available at
  [senkey-deploy.zip](https://drive.google.com/file/d/1JP2zc87otL8IQrM8A0HCQ4mAjK5GF95S/view?usp=drive_link).

## Extension Setup and Daily Use

First-time setup:

1. Open SenKey from the browser toolbar.
2. Open the `⚙` tab.
3. Sign In With Google.
4. Enter `API URL`.
5. Enter `API Key`.
6. Save settings.

Daily use:

- `Fill`
  Click a saved credential to fill the current login page or open the saved login page and fill there. Credentials are grouped by folder when folders are assigned.
- `Add`
  Save a new credential or update an existing one. Fields: `Domain`, `Username / Email`, `Password`, `Login URL`, and `Folder`.
- `Settings`
  Sign in, save backend settings, back up encryption keys, and import or export Login Pages.
- `Help`
  Open the built-in help page.

Settings also includes Login Pages backup controls. `Export Login Pages` downloads a
JSON backup of the current browser login page list and also tries to write that
same backup to the signed-in user's bucket document. If the bucket save fails,
the local JSON download still completes. `Import Login Pages` reads a JSON backup,
replaces the bucket login page backup, and restores it into a new browser folder.

The full user-facing guide is in `USER-MANUAL.md`, and the installed extension also includes its own help page at `extension/manual.html`.

## Login URL Behavior

Each credential can store a `loginUrl` in addition to its domain.

That login URL helps SenKey:

- reopen the exact sign-in page later
- avoid landing on a generic home page
- improve fill reliability on sites with custom login routes

SenKey updates login URLs only when it believes the current page is a real login page.

## Folder Behavior

Use the `Folder` field to group credentials. Nested folders use `/`, such as
`Work/Clients`.

Click `✎` on a folder header to rename the folder path. If the destination
folder already exists, SenKey automatically merges the credentials into that
folder. Existing credentials are not duplicated or deleted; their saved folder
paths are updated on the backend so the structure follows the signed-in Google
user across browsers. If a folder update has not appeared in the next backend
fetch yet, the extension keeps a temporary local retry entry and pushes it again
on the next popup open.

## Security Model

- Passwords are encrypted client-side before upload.
- The backend receives encrypted password data, not plaintext passwords.
- Google sign-in separates one user's data from another user's data.
- The API key acts as a shared server-level gate.
- Exported SenKey keys are sensitive and should be stored privately.
- Login page backups are stored in the user's configured bucket when the user
  clicks `Export Login Pages`, imports a login page backup, or changes login pages
  while the popup is open. Export also creates a local JSON download, and
  imports are added to a new browser folder.
- Credential folder paths are saved with credential records in the bucket.
  Browser-local storage is used only for UI state and short-lived retry state.

## Browser Support

| Browser | Status |
|---|---|
| Chrome | Supported |
| Edge | Supported |
| Brave | Supported |
| Firefox | Not supported |

## Development Notes

- Extension UI and autofill logic live in `extension/popup.js`.
- Background navigation and post-navigation fill logic live in `extension/background.js`.
- The Cloud Run backend is `docker/index.php`.

# SenKey

SenKey is a Chromium extension that stores and autofills credentials from your own backend instead of a third-party password manager.

It is built around four ideas:

- credentials are encrypted in the extension before upload
- each Google user gets a separate credential store
- saved entries can remember a full login page URL, not just a domain
- you can run the backend on simple PHP hosting or on Google Cloud Run

## What SenKey does

- Saves credentials to your own backend
- Encrypts passwords in the extension before upload
- Autofills many standard, SPA, shadow DOM, and multi-step login forms
- Stores a login URL so a credential can reopen the correct sign-in page later
- Can navigate to a saved login page and autofill after the page loads
- Keeps data separated by signed-in Google user

## Project layout

```text
SenKey-autofill-extension/
├── extension/          Chrome extension source
├── server/             Simple self-hosted PHP backend
├── docker/             Google Cloud Run backend
├── build.sh            Extension build script
├── deploy.sh           Repo-root Cloud Run deploy wrapper
├── package-deploy.sh   Creates a backend-only shareable bundle
├── USER-MANUAL.md      User-facing extension manual
└── README.md
```

## Choose a backend

SenKey supports two backend options:

- `server/credentials.php`
  Best when you already have PHP hosting and want the simplest possible server setup.
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
- `REGION`
- `API_KEY`, or leave it blank so `./deploy.sh` generates one automatically

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

The repo-root [deploy.sh](/Users/aehrath/code/SenKey-autofill-extension/deploy.sh:1) is the standard deployment entry point. It runs [docker/deploy.sh](/Users/aehrath/code/SenKey-autofill-extension/docker/deploy.sh:1) for you.

What the deploy script does:

- enables the required Google Cloud APIs
- creates or reuses the Cloud Run service `senkey-api`
- creates or reuses the storage bucket `${PROJECT_ID}-senkey`
- creates or reuses the Artifact Registry repository `senkey`
- builds the backend image with Cloud Build
- sets `API_KEY`, `GCS_BUCKET`, and `CHROME_EXTENSION_ID` on Cloud Run
- prints the final service URL and API key

SenKey no longer uses Cloud Run source deploys, so new deploys should not create or recreate a `run-sources...` bucket. If an older deploy already created one, you can delete that bucket after confirming no deploy is currently running. SenKey stores credentials only in `${PROJECT_ID}-senkey`.

What you set manually in `.env`:

- `PROJECT_ID`
- `REGION`
- `CHROME_EXTENSION_ID`
- `API_KEY` if you want to choose your own shared key

What is automatic:

- `GCS_BUCKET`
- bucket creation
- Artifact Registry repository creation
- API enablement
- `API_KEY` generation if the field is blank

You do not need to add `GCS_BUCKET` manually to `.env`.

Detailed Cloud Run docs live in:

- [docker/README.md](/Users/aehrath/code/SenKey-autofill-extension/docker/README.md:1)
- [docker/INSTALL.md](/Users/aehrath/code/SenKey-autofill-extension/docker/INSTALL.md:1)

## Self-Hosted PHP Deployment

If you want the lightest backend possible, use [server/credentials.php](/Users/aehrath/code/SenKey-autofill-extension/server/credentials.php:1).

Basic setup:

1. Set the API key in the environment or in the script.
2. Upload the file to an HTTPS-enabled PHP host.
3. Make sure the directory is writable so per-user JSON files can be created.
4. Point the extension `API URL` to that endpoint.

The current backend stores one JSON file per Google user and supports `GET`, `POST`, and `DELETE`.

## Google OAuth Setup

SenKey uses `chrome.identity`, so it needs a Google OAuth client created for a Chrome extension.

If you use the published SenKey extension without modifying or rebuilding it,
you do not need to create your own Google OAuth client. The published extension
already contains the correct OAuth client ID. You only need to deploy your
backend and paste the backend `API URL` and `API Key` into the extension.

Create your own OAuth client only if you build, fork, or load your own copy of
the extension. For production builds, copy the generated client ID into `.env`
as `GOOGLE_OAUTH_CLIENT_ID`. For local dev builds, run `./build.sh` once to get
the stable dev extension ID, create a Chrome Extension OAuth client for that ID,
then copy the generated client ID into `.env` as `DEV_GOOGLE_OAUTH_CLIENT_ID`.

Google Cloud Console flow:

1. Open [Google Cloud Console](https://console.cloud.google.com).
2. Select your project.
3. Open `Google Auth Platform` or `APIs & Services`.
4. Open `Credentials`.
5. Click `Create Credentials`.
6. Create an OAuth client for a Chrome extension / Chrome App.
7. When asked for the Chrome App / Item ID, enter the extension ID:

```text
gcmgfpkabdjhniklindbjieohnfngchg
```

For a dev build, use the dev extension ID printed by `./build.sh` instead.

8. Finish creation and copy the generated OAuth client ID.
9. Put that value into `.env` as `GOOGLE_OAUTH_CLIENT_ID` for production builds,
   or `DEV_GOOGLE_OAUTH_CLIENT_ID` for local dev builds.
10. Run `./build.sh` so the manifest gets the current client ID automatically.

The extension ID is also stored in `.env` as `CHROME_EXTENSION_ID`.

### Google Sign-In Error: `400 invalid_request`

This error is usually an extension OAuth setup problem, not a Cloud Run
backend problem.

Check these items:

- In Brave, open `brave://settings/extensions`, enable `Allow Google login for
  extensions`, then try signing in from SenKey again.
- In Brave, also sign into Google in a normal browser tab, then reload SenKey.
  Brave says the extension login setting has no effect when the browser is not
  logged into Google.
- If you are using the published SenKey extension unchanged, do not rebuild it
  with another OAuth client. Reinstall or reload the published build, then paste
  only your backend `API URL` and `API Key` in Settings.
- The OAuth client in Google Cloud must be type `Chrome extension` / `Chrome
  App`, not `Web application` or `Desktop app`. This applies only to custom
  extension builds.
- The Chrome App / Item ID on that OAuth client must exactly match the
  installed extension ID.
- For the published SenKey extension, use:

```text
gcmgfpkabdjhniklindbjieohnfngchg
```

- If you are loading an unpacked development build, use the dev extension ID
  printed by `./build.sh` when creating `DEV_GOOGLE_OAUTH_CLIENT_ID`.
- After changing `GOOGLE_OAUTH_CLIENT_ID` or `DEV_GOOGLE_OAUTH_CLIENT_ID`, run
  `./build.sh`, reload the extension, and sign in again.

The downloaded `client_secret_*.json` file from Google Cloud is not used by
this Chrome extension. Only the generated OAuth client ID belongs in `.env`.

## Build Commands

Use [build.sh](/Users/aehrath/code/SenKey-autofill-extension/build.sh:1) for extension builds.

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
  `extension.dev.pem`.
- `./build.sh prod`
  Creates `senkey.zip` for Chrome Web Store upload. Production builds do not
  include a manifest key.
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
3. Sign in with Google.
4. Enter `API URL`.
5. Enter `API Key`.
6. Save settings.

Daily use:

- `Fill`
  Click a saved credential to fill the current login page or open the saved login page and fill there.
- `Add`
  Save a new credential or update an existing one.
- `Help`
  Open the built-in help page.

The full user-facing guide is in [USER-MANUAL.md](/Users/aehrath/code/SenKey-autofill-extension/USER-MANUAL.md:1), and the installed extension also includes its own help page at [extension/manual.html](/Users/aehrath/code/SenKey-autofill-extension/extension/manual.html:1).

## Login URL Behavior

Each credential can store a `loginUrl` in addition to its domain.

That login URL helps SenKey:

- reopen the exact sign-in page later
- avoid landing on a generic home page
- improve fill reliability on sites with custom login routes

SenKey updates login URLs only when it believes the current page is a real login page.

## Security Model

- Passwords are encrypted client-side before upload.
- The backend receives encrypted password data, not plaintext passwords.
- Google sign-in separates one user’s data from another user’s data.
- The API key acts as a shared server-level gate.
- Exported SenKey keys are sensitive and should be stored privately.

## Browser Support

| Browser | Status |
|---|---|
| Chrome | Supported |
| Edge | Supported |
| Brave | Supported |
| Firefox | Not supported |

## Development Notes

- Extension UI and autofill logic live in [extension/popup.js](/Users/aehrath/code/SenKey-autofill-extension/extension/popup.js:1).
- Background navigation and post-navigation fill logic live in [extension/background.js](/Users/aehrath/code/SenKey-autofill-extension/extension/background.js:1).
- The simple PHP backend is [server/credentials.php](/Users/aehrath/code/SenKey-autofill-extension/server/credentials.php:1).
- The Cloud Run backend is [docker/index.php](/Users/aehrath/code/SenKey-autofill-extension/docker/index.php:1).

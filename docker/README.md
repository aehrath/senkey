# SenKey Cloud Run Backend

This folder contains the Google Cloud Run backend for SenKey.

It is the server-side part of SenKey that:

- receives requests from the browser extension
- checks the shared `X-API-Key`
- verifies the signed-in Google user
- stores one credential file per Google user in Google Cloud Storage

## What this backend uses

- Cloud Run for the PHP API
- Cloud Build to build the backend container image
- Artifact Registry to store the backend container image
- Google Cloud Storage for credential data

## Files in this folder

- [index.php](index.php)
  The backend API used by the extension.
- [Dockerfile](Dockerfile)
  The Cloud Run container definition.
- [deploy.sh](deploy.sh)
  The deployment script.
- [INSTALL.md](INSTALL.md)
  A shorter checklist-style install guide.

## Before you deploy

Make sure:

- the Google Cloud CLI `gcloud` is installed
- you have run `gcloud auth login`
- your Google account can deploy Cloud Run resources in the target project
- billing is enabled for the project if your Google Cloud account requires it

## Create `.env`

Download and unzip the backend deployment bundle:
[senkey-deploy.zip](https://drive.google.com/file/d/1JP2zc87otL8IQrM8A0HCQ4mAjK5GF95S/view?usp=drive_link).

Create `.env` next to the deployment files:

```bash
cp .env.example .env
```

Then fill in:

- `PROJECT_ID`
- `REGION`
- `CHROME_EXTENSION_ID`
- `API_KEY` if you want to choose your own shared key

If `API_KEY` is blank, `deploy.sh` will generate a strong key, save it back into `.env`, and print it at the end.

For the published SenKey extension, `CHROME_EXTENSION_ID` should be:

```text
gcmgfpkabdjhniklindbjieohnfngchg
```

## Deploy

```bash
./deploy.sh
```

Run it from the folder that contains `deploy.sh`.

## What deploy.sh does

The deployment script:

1. verifies the target project
2. enables the required Google Cloud APIs
3. creates or reuses the storage bucket `${PROJECT_ID}-senkey`
4. creates or reuses the Artifact Registry repository `senkey`
5. builds the backend container image with Cloud Build
6. deploys that image to Cloud Run
7. sets runtime environment variables on the service
8. prints the final API URL and API key

## What gets created automatically

During deploy, the script creates or reuses:

- a Cloud Run service named `senkey-api`
- a storage bucket named `${PROJECT_ID}-senkey`
- an Artifact Registry repository named `senkey`

SenKey no longer uses Cloud Run source deploys, so new deploys should not create or recreate a `run-sources...` bucket. If an older deploy already created one, you can delete that bucket after confirming no deploy is currently running. SenKey stores credential files only in `${PROJECT_ID}-senkey`.

It also sets these Cloud Run environment variables automatically:

- `API_KEY`
- `GCS_BUCKET`
- `CHROME_EXTENSION_ID`

You do not need to add `GCS_BUCKET` to `.env`.

## After deploy

When deployment finishes, the script prints:

- `API URL`
- `API Key`
- `Ext ID`

Use those values in the extension:

1. Open SenKey.
2. Open the `⚙` tab.
3. Sign in with Google.
4. Paste the Cloud Run service URL into `API URL`.
5. Paste the same key into `API Key`.
6. Click `Save Settings`.

## Google OAuth note

OAuth client IDs are used by the browser extension build, not by this backend.

If you use the published SenKey extension unchanged, you do not need to create
your own Google OAuth client. Create OAuth clients only when you build, fork, or
load your own copy of the extension.

For custom extension builds, see the Google OAuth setup in
[../README.md](../README.md). Chrome and Edge use a `Chrome extension` OAuth
client. Brave may also need a separate `Web application` OAuth client for the
fallback sign-in flow.

## Runtime variables

The deployed backend runs with:

- `API_KEY`
- `GCS_BUCKET`
- `CHROME_EXTENSION_ID`

Meaning:

- `API_KEY`
  Shared secret between the extension and backend.
- `GCS_BUCKET`
  Storage bucket for per-user credential JSON files.
- `CHROME_EXTENSION_ID`
  Kept in the Cloud Run config for consistency and reference.

## Stored data layout

Each signed-in Google user gets a separate Cloud Storage object:

```text
credentials/<google-sub-sanitized>.json
```

Inside that file, credentials are keyed by:

```text
md5(domain + "|" + username)
```

## Troubleshooting

### Google sign-in fails

This comes from extension Google sign-in, not from Cloud Run.

- If you use the published extension unchanged, reinstall or reload it and
  configure only `API URL` and `API Key`.
- In Brave, enable `brave://settings/extensions` > `Allow Google login for
  extensions`, then sign into Google in a normal Brave tab.
- For custom extension builds, confirm the OAuth clients in `.env` match the
  installed extension ID, run `./build.sh`, and reload `dist/`.

### `Unauthorized`

Check that:

- the extension `API Key` matches the deployed `API_KEY`
- the extension is pointed at the correct Cloud Run URL

### `Google sign-in required`

Check that:

- the user is signed in through the extension
- custom extension builds follow the OAuth setup in the repo README
- Google sign-in is working in the extension

### `GCS_BUCKET env var not set`

Check that:

- the deploy finished successfully
- the latest Cloud Run revision is active

### Credentials save but do not persist

Check that:

- the deployment targeted the correct project
- the storage bucket name matches the deployed service config

## Related docs

- [../README.md](../README.md)
- [INSTALL.md](INSTALL.md)
- [../USER-MANUAL.md](../USER-MANUAL.md)

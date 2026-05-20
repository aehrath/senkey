# SenKey Cloud Run Install Guide

Use this guide for the shortest possible checklist for deploying the SenKey backend to Google Cloud Run.

## Prerequisites

- A Google Cloud project
- `gcloud` installed
- `gcloud auth login` completed
- Permission to use Cloud Run, Cloud Build, Artifact Registry, and Cloud Storage

## 1. Create `.env`

Download and unzip the backend deployment bundle:
[senkey-deploy.zip](https://drive.google.com/file/d/1JP2zc87otL8IQrM8A0HCQ4mAjK5GF95S/view?usp=drive_link).

```bash
cp .env.example .env
```

Fill in:

- `PROJECT_ID`
- `REGION`
- `CHROME_EXTENSION_ID`
- `API_KEY`, or leave it blank for automatic generation

For the published SenKey extension:

```text
CHROME_EXTENSION_ID=gcmgfpkabdjhniklindbjieohnfngchg
```

## 2. Deploy

```bash
./deploy.sh
```

Run it from the folder that contains `deploy.sh`.

## 3. What happens automatically

The deploy script:

- enables required APIs
- creates the storage bucket `${PROJECT_ID}-senkey`
- creates the Artifact Registry repository `senkey`
- builds the backend container image with Cloud Build
- deploys that image to Cloud Run
- sets `API_KEY`
- sets `GCS_BUCKET`
- sets `CHROME_EXTENSION_ID`

If `API_KEY` is blank, the script generates one and writes it back into `.env`.

SenKey no longer uses Cloud Run source deploys, so new deploys should not create
or recreate a `run-sources...` bucket. If an older deploy already created one,
you can delete that bucket after confirming no deploy is currently running.
SenKey stores credentials only in `${PROJECT_ID}-senkey`.

## 4. Configure the extension

When deploy finishes, copy the printed values into SenKey:

1. Open the extension.
2. Open `⚙`.
3. Sign in with Google.
4. Paste `API URL`.
5. Paste `API Key`.
6. Click `Save Settings`.

## Notes

- You do not need to add `GCS_BUCKET` to `.env`.
- If you use the published SenKey extension unchanged, you do not need your own
  Google OAuth client. The published extension already has one.
- `GOOGLE_OAUTH_CLIENT_ID` and `DEV_GOOGLE_OAUTH_CLIENT_ID` are used only when
  building your own extension. They are not used by the backend API.

## Troubleshooting

- `400 invalid_request` during Google sign-in
  This comes from extension Google sign-in, not from Cloud Run. Steps to resolve:
  - In Brave, open `brave://settings/extensions`, enable `Allow Google login for extensions`.
  - Sign into Google in a normal Brave tab, reload SenKey, then try again.
    (The extension login setting has no effect when the browser is not logged into Google.)
  - If you use the published SenKey extension unchanged, reinstall or reload it and configure only `API URL` and `API Key`.
  - If you build your own extension, create a Google OAuth client with type `Chrome extension` / `Chrome App`.
    Make its Chrome App / Item ID match the installed extension ID, then put the generated client ID in `.env`
    as `GOOGLE_OAUTH_CLIENT_ID` for production builds or `DEV_GOOGLE_OAUTH_CLIENT_ID` for dev builds.
    Run `./build.sh` and reload the extension.
- `Unauthorized`
  Check that the extension `API Key` matches the deployed `API_KEY`.
- `Google sign-in required`
  Check that the extension has the correct OAuth client ID and the user is signed in.
- `GCS_BUCKET env var not set`
  Redeploy and confirm the latest Cloud Run revision is active.

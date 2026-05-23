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
- OAuth client IDs are used only when building your own extension. They are not
  used by the backend API.

## Troubleshooting

- Google sign-in fails
  This comes from extension Google sign-in, not from Cloud Run. If you use the
  published extension unchanged, configure only `API URL` and `API Key`. In
  Brave, enable `brave://settings/extensions` > `Allow Google login for
  extensions`, then sign into Google in a normal Brave tab. For custom extension
  builds, confirm the OAuth clients in `.env` match the installed extension ID,
  run `./build.sh`, and reload `dist/`.
- `Unauthorized`
  Check that the extension `API Key` matches the deployed `API_KEY`.
- `Google sign-in required`
  Check that the user is signed in through the extension. For custom extension
  builds, also check the OAuth setup in the repo README.
- `GCS_BUCKET env var not set`
  Redeploy and confirm the latest Cloud Run revision is active.

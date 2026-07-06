# SenKey Changelog

Current version: `1.4.1`

All notable user-facing changes are tracked here. The extension version is set in
`extension/manifest.json`.

## 1.4.1 - 2026-07-06

### Added

- Added Windows PowerShell deployment scripts for Cloud Run.

### Changed

- Updated deployment documentation and backend bundle packaging for Windows.

## 1.4.0 - 2026-07-05

### Added

- Added a secure password suggestion button in the Add tab.
- Added visible version numbers to the documentation set.
- Added this changelog.

### Changed

- Polished the password suggestion implementation and password-field
  accessibility states.
- Clarified OAuth backend allow-list documentation, including the
  `Google token audience is not allowed` troubleshooting path.

## 1.3.0 - 2026-05-23

### Added

- Added Login Pages import/export support from Settings.
- Added bucket-backed login page backups for Cloud Run deployments.
- Added credential folder paths that follow the signed-in Google user across
  browsers.

### Changed

- Improved folder handling, including nested folders, collapsed state, folder
  rename, and merge behavior.
- Improved Cloud Run deployment documentation and production build guidance.

## Earlier History - 2026-05

### Added

- Initial Chromium extension for storing, encrypting, and autofilling
  credentials from a user-controlled backend.
- Google sign-in based user separation.
- Client-side password encryption before upload.
- Login URL storage and navigation-assisted autofill.

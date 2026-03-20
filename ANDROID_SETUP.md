# Estou Bem - Android Setup for Google Play Internal Testing

## Prerequisites

- Node.js 18+
- EAS CLI installed: `npm install -g eas-cli`
- Expo account: `eas login`

---

## 1. Google Play Developer Account

1. Go to https://play.google.com/console/signup
2. Sign in with the Google account you want to use as the publisher
3. Pay the one-time $25 registration fee
4. Complete the account details (developer name, contact email, etc.)
5. Wait for account approval (usually within 48 hours)

---

## 2. Create Your App in Google Play Console

1. Open Google Play Console: https://play.google.com/console
2. Click **Create app**
3. Fill in:
   - App name: **Estou Bem**
   - Default language: **Portuguese (Brazil)**
   - App or game: **App**
   - Free or paid: **Free**
4. Accept the declarations and click **Create app**

---

## 3. Create a Service Account for Automated Uploads

This allows `eas submit` to upload builds without manual intervention.

### 3a. Create the service account in Google Cloud Console

1. Go to https://console.cloud.google.com
2. Select or create a project linked to your Play Console
3. Navigate to **IAM & Admin > Service Accounts**
4. Click **Create Service Account**
   - Name: `eas-submit-estou-bem`
   - Description: "Service account for EAS automated submissions"
5. Click **Create and Continue**
6. Skip the optional role/access steps for now, click **Done**
7. Click on the newly created service account
8. Go to the **Keys** tab
9. Click **Add Key > Create new key > JSON**
10. Download the JSON file and save it as `play-store-service-account.json` in the project root

### 3b. Grant access in Google Play Console

1. Go to Google Play Console > **Settings > API access**
2. Link your Google Cloud project if not already linked
3. Under **Service accounts**, find the one you just created
4. Click **Manage Play Console permissions**
5. Grant these permissions:
   - **Releases**: View and manage releases, including testing tracks
   - **App information**: View app information
6. Apply permissions to **Estou Bem** (or all apps)
7. Click **Invite user** and confirm

### 3c. Important

Add `play-store-service-account.json` to your `.gitignore` -- this file contains sensitive credentials and must never be committed to version control.

```
# .gitignore
play-store-service-account.json
```

---

## 4. Build the Android App

### Development build (APK for local testing)

```bash
eas build --profile development --platform android
```

### Preview build (APK for internal team testing)

```bash
eas build --profile preview --platform android
```

### Production build (AAB for Google Play)

```bash
eas build --profile production --platform android
```

The production profile uses `app-bundle` format (AAB), which is required by Google Play. The `versionCode` is auto-incremented by EAS on each production build via the `appVersionSource: "remote"` setting in `eas.json`.

---

## 5. Submit to Google Play Internal Testing

Once a production build completes:

```bash
eas submit --platform android --latest
```

Or submit a specific build:

```bash
eas submit --platform android --id BUILD_ID
```

EAS will use the service account key at `./play-store-service-account.json` and upload to the **internal** testing track, as configured in `eas.json`.

---

## 6. Set Up Internal Testing in Google Play Console

1. Go to Google Play Console > **Estou Bem** > **Testing > Internal testing**
2. Click **Create new release** (if EAS submit has not already created one)
3. Under **Testers**, click **Create email list**
   - Name: "Internal Testers"
   - Add email addresses of testers (up to 100)
4. Save and enable the email list for the internal testing track
5. Click **Review release** and then **Start rollout to Internal testing**
6. Share the **opt-in link** with testers -- they will find it under the track details page
   - Testers must accept the invite via the link before they can install the app
   - The app will appear in the Play Store for accepted testers only

### Notes on internal testing

- Internal testing track has no review process -- builds are available to testers within minutes
- Maximum 100 testers per internal testing track
- Testers must have a Google account and use it on their Android device
- First-time setup may take a few hours for the opt-in link to become active

---

## Quick Reference

| Command | Purpose |
|---|---|
| `eas build --profile development --platform android` | APK for development |
| `eas build --profile preview --platform android` | APK for internal team |
| `eas build --profile production --platform android` | AAB for Play Store |
| `eas submit --platform android --latest` | Upload latest build to internal track |
| `eas submit --platform android --id BUILD_ID` | Upload specific build |

---

## Troubleshooting

- **"Service account not found"**: Verify the JSON key path in `eas.json` and ensure the service account has Play Console permissions.
- **"Version code already used"**: EAS auto-increments versionCode when `appVersionSource` is set to `"remote"`. If you hit conflicts, check the current versionCode in Play Console and ensure it matches.
- **"App signing"**: Google Play manages app signing by default. On first upload, Play will generate and manage the signing key. EAS handles the upload key automatically.

# Estou Bem — Setup & Deployment Guide

## Prerequisites
- Node.js 18+
- Expo CLI (`npx expo`)
- EAS CLI (`npm install -g eas-cli`)
- Apple Developer Account (for iOS)
- Google Play Developer Account (for Android)
- RevenueCat account (for subscriptions)

## 1. Initial Setup

```bash
cd estou-bem
npm install
```

## 2. RevenueCat Configuration (Required for Subscriptions)

### Create products in App Store Connect / Google Play Console:
| Product ID | Platform | Price |
|---|---|---|
| `com.estoubem.familia.monthly` | iOS + Android | R$ 49.90/month |
| `com.estoubem.central.monthly` | iOS + Android | R$ 89.90/month |

### Setup in RevenueCat:
1. Create a project at https://app.revenuecat.com
2. Add iOS and Android apps
3. Create entitlements: `familia` and `central`
4. Create an offering named `default` with both packages
5. Copy API keys and set in environment or `app.config.ts`:
   - `REVENUECAT_APPLE_API_KEY`
   - `REVENUECAT_GOOGLE_API_KEY`

## 3. EAS Build Configuration

```bash
# Login to Expo
eas login

# Configure project
eas build:configure

# Update eas.json with your:
# - Apple Team ID
# - ASC App ID
# - Google Play service account key
```

Update `eas.json` and `app.config.ts` with your actual:
- `YOUR_EAS_PROJECT_ID`
- `YOUR_APPLE_ID@email.com`
- `YOUR_ASC_APP_ID`
- `YOUR_TEAM_ID`

## 4. Build for Stores

### iOS
```bash
# Development build (simulator)
eas build --platform ios --profile development

# Production build (App Store)
eas build --platform ios --profile production

# Submit to App Store
eas submit --platform ios --profile production
```

### Android
```bash
# Preview APK
eas build --platform android --profile preview

# Production AAB (Google Play)
eas build --platform android --profile production

# Submit to Google Play
eas submit --platform android --profile production
```

## 5. App Store Submission Checklist

### Apple App Store
- [ ] App icon (1024x1024)
- [ ] Screenshots (6.7", 6.5", 5.5" iPhones + iPad)
- [ ] App description (see `store-metadata/`)
- [ ] Keywords
- [ ] Privacy policy URL
- [ ] Terms of use URL
- [ ] In-App Purchase products created and approved
- [ ] Review notes (see `store-metadata/review-notes.txt`)
- [ ] Age rating: 4+ (medical/health)
- [ ] Category: Health & Fitness / Medical

### Google Play
- [ ] App icon (512x512)
- [ ] Feature graphic (1024x500)
- [ ] Screenshots (phone + tablet)
- [ ] Full description
- [ ] Short description
- [ ] Privacy policy URL
- [ ] Content rating questionnaire
- [ ] Subscription products created
- [ ] Category: Health & Fitness
- [ ] Target audience: General

## 6. Assets to Create
- `assets/icon.png` — 1024x1024 app icon
- `assets/adaptive-icon.png` — Android adaptive icon foreground
- `assets/splash-icon.png` — Splash screen icon
- `assets/notification-icon.png` — 96x96 Android notification icon
- `assets/checkin-alarm.wav` — Custom alarm sound for check-ins

## 7. Environment Variables
```env
REVENUECAT_APPLE_API_KEY=appl_xxxxx
REVENUECAT_GOOGLE_API_KEY=goog_xxxxx
APPSFLYER_DEV_KEY=xxxxx
APPSFLYER_APP_ID=xxxxx
```

## 8. AppsFlyer Integration (Attribution/Affiliate)
1. Create AppsFlyer account
2. Add app and get dev key
3. Configure postback URLs for affiliate partners
4. Events tracked: see `ConversionEvent` type in `src/types/index.ts`

## Project Structure
```
estou-bem/
├── App.tsx                    # Entry point
├── app.config.ts              # Expo config (iOS/Android/permissions)
├── eas.json                   # EAS Build & Submit config
├── src/
│   ├── components/            # Reusable UI components
│   ├── constants/             # Theme, subscription plans
│   ├── navigation/            # React Navigation setup
│   ├── screens/               # All app screens
│   ├── services/              # Business logic services
│   │   ├── CheckInService.ts     # Check-in scheduling & escalation
│   │   ├── FallDetectionService.ts # Accelerometer fall detection
│   │   ├── LocationService.ts     # GPS & geofencing
│   │   ├── NotificationService.ts # Push notifications
│   │   └── RevenueCatService.ts   # Subscription management
│   ├── store/                 # App state (Context + AsyncStorage)
│   └── types/                 # TypeScript definitions
└── store-metadata/            # App Store & Google Play descriptions
```

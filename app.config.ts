import { ExpoConfig, ConfigContext } from "expo/config";

export default ({ config }: ConfigContext): ExpoConfig => ({
  ...config,
  name: "Estou Bem",
  slug: "estou-bem",
  version: "1.0.0",
  orientation: "portrait",
  icon: "./assets/icon.png",
  userInterfaceStyle: "light",
  scheme: "estoubem",
  splash: {
    image: "./assets/splash-icon.png",
    resizeMode: "contain",
    backgroundColor: "#4A90D9",
  },
  assetBundlePatterns: ["**/*"],
  ios: {
    supportsTablet: true,
    bundleIdentifier: "com.estoubem.app",
    buildNumber: "1",
    infoPlist: {
      NSLocationWhenInUseUsageDescription:
        "Estou Bem uses your location to notify family members in case of emergency and for geofencing safety zones.",
      NSLocationAlwaysAndWhenInUseUsageDescription:
        "Estou Bem needs background location access to detect when the elderly person leaves safe zones and to share location during emergencies.",
      NSMotionUsageDescription:
        "Estou Bem uses motion sensors to detect falls and monitor activity for the check-in system.",
      NSHealthShareUsageDescription:
        "Estou Bem reads health data to enrich check-in information shared with family members.",
      UIBackgroundModes: ["fetch", "remote-notification", "location"],
      SKAdNetworkItems: [
        { SKAdNetworkIdentifier: "v9wttpbfk9.skadnetwork" }, // AppsFlyer
        { SKAdNetworkIdentifier: "2u9pt9hc89.skadnetwork" }, // Facebook
        { SKAdNetworkIdentifier: "4fzdc2evr5.skadnetwork" }, // Facebook
        { SKAdNetworkIdentifier: "ydx93a7ass.skadnetwork" }, // Google
      ],
    },
    config: {
      usesNonExemptEncryption: false,
    },
  },
  android: {
    adaptiveIcon: {
      foregroundImage: "./assets/adaptive-icon.png",
      backgroundColor: "#4A90D9",
    },
    package: "com.estoubem.app",
    versionCode: 1,
    permissions: [
      "ACCESS_FINE_LOCATION",
      "ACCESS_COARSE_LOCATION",
      "ACCESS_BACKGROUND_LOCATION",
      "ACTIVITY_RECOGNITION",
      "RECEIVE_BOOT_COMPLETED",
      "VIBRATE",
      "POST_NOTIFICATIONS",
      "FOREGROUND_SERVICE",
      "FOREGROUND_SERVICE_HEALTH",
      "BODY_SENSORS",
      "HIGH_SAMPLING_RATE_SENSORS",
    ],
    googleServicesFile: "./google-services.json",
  },
  plugins: [
    [
      "expo-notifications",
      {
        icon: "./assets/notification-icon.png",
        color: "#4A90D9",
        sounds: ["./assets/checkin-alarm.wav"],
      },
    ],
    [
      "expo-location",
      {
        locationAlwaysAndWhenInUsePermission:
          "Allow Estou Bem to use your location for emergency sharing and geofencing.",
        isAndroidBackgroundLocationEnabled: true,
      },
    ],
    [
      "expo-sensors",
      {
        motionPermission:
          "Allow Estou Bem to access motion data for fall detection.",
      },
    ],
    ["expo-background-fetch"],
    ["expo-task-manager"],
  ],
  extra: {
    revenueCatAppleApiKey: process.env.REVENUECAT_APPLE_API_KEY || "appl_YOUR_KEY_HERE",
    revenueCatGoogleApiKey: process.env.REVENUECAT_GOOGLE_API_KEY || "goog_YOUR_KEY_HERE",
    appsflyerDevKey: process.env.APPSFLYER_DEV_KEY || "YOUR_APPSFLYER_DEV_KEY",
    appsflyerAppId: process.env.APPSFLYER_APP_ID || "YOUR_APP_ID",
    eas: {
      projectId: "YOUR_EAS_PROJECT_ID",
    },
  },
});

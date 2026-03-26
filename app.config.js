export default ({ config }) => ({
  ...config,
  name: "Estou Bem",
  slug: "estou-bem",
  version: "1.1.0",
  orientation: "portrait",
  icon: "./assets/icon.png",
  userInterfaceStyle: "light",
  scheme: "estoubem",
  splash: {
    image: "./assets/splash-icon.png",
    resizeMode: "contain",
    backgroundColor: "#F5F0EB",
  },
  ios: {
    supportsTablet: false,
    bundleIdentifier: "com.twerner.estoubem",
    appleTeamId: "7Q97Z7U42U",
    buildNumber: "5",
    infoPlist: {
      NSLocationWhenInUseUsageDescription:
        "Estou Bem usa sua localização para notificar familiares em caso de emergência.",
      NSLocationAlwaysAndWhenInUseUsageDescription:
        "Estou Bem precisa de acesso à localização em segundo plano para detectar quando o idoso sai de zonas seguras.",
      NSMotionUsageDescription:
        "Estou Bem usa sensores de movimento para detectar quedas e monitorar atividade.",
      NSHealthShareUsageDescription:
        "Estou Bem usa dados de saúde para monitorar o bem-estar do idoso e alertar familiares.",
      NSHealthUpdateUsageDescription:
        "Estou Bem registra check-ins de saúde para acompanhamento familiar.",
      UIBackgroundModes: ["fetch", "remote-notification"],
    },
    entitlements: {
      "com.apple.developer.healthkit": true,
      "com.apple.developer.healthkit.access": [],
    },
    config: {
      usesNonExemptEncryption: false,
    },
  },
  android: {
    adaptiveIcon: {
      foregroundImage: "./assets/android-icon-foreground.png",
      backgroundImage: "./assets/android-icon-background.png",
      monochromeImage: "./assets/android-icon-monochrome.png",
      backgroundColor: "#F5F0EB",
    },
    package: "com.twerner.estoubem",
    versionCode: 27,
    permissions: [
      "ACTIVITY_RECOGNITION",
      "RECEIVE_BOOT_COMPLETED",
      "VIBRATE",
      "POST_NOTIFICATIONS",
    ],
  },
  plugins: [
    [
      "expo-notifications",
      {
        color: "#2D4A3E",
      },
    ],
    [
      "expo-location",
      {
        locationAlwaysAndWhenInUsePermission:
          "Estou Bem usa sua localização para compartilhar em emergências.",
      },
    ],
    [
      "expo-sensors",
      {
        motionPermission:
          "Estou Bem usa sensores de movimento para detecção de quedas.",
      },
    ],
    ["expo-background-fetch"],
    ["expo-task-manager"],
    ["@bacons/apple-targets"],
    ["./plugins/withAsyncStorageRepo"],
    // ["./plugins/withWearOS"], // Wear OS built separately via GitHub Actions
  ],
  extra: {
    revenueCatAppleApiKey:
      process.env.REVENUECAT_APPLE_API_KEY ||
      "test_cHyaMgQCNfspyCJvEhlgIXqIalw",
    revenueCatGoogleApiKey:
      process.env.REVENUECAT_GOOGLE_API_KEY || "placeholder",
    appsflyerDevKey: process.env.APPSFLYER_DEV_KEY || "placeholder",
    appsflyerAppId: process.env.APPSFLYER_APP_ID || "placeholder",
    eas: {
      projectId: "2c5b816f-19cf-46ec-bc64-33fc65b47033",
    },
  },
});

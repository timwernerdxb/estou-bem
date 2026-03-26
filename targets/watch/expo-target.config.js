/** @type {import('@bacons/apple-targets').Config} */
module.exports = {
  type: "watch",
  name: "EstouBemWatch",
  bundleIdentifier: ".watchkitapp",
  deploymentTarget: "9.0",
  frameworks: [
    "SwiftUI",
    "WatchConnectivity",
    "CoreMotion",
    "HealthKit",
  ],
  entitlements: {
    "com.apple.developer.healthkit": true,
    "com.apple.developer.healthkit.access": [],
  },
  icon: "./Assets.xcassets/AppIcon.appiconset/icon-1024.png",
  colors: {
    $accent: "#2D4A3E",
  },
};

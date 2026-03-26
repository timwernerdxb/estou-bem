/** @type {import('@bacons/apple-targets').Config} */
module.exports = {
  type: "watch",
  name: "EstouBemWatch",
  bundleIdentifier: ".watchkitapp",
  deploymentTarget: "10.0",
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
  colors: {
    $accent: "#2D4A3E",
  },
};

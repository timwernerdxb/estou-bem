const {
  withSettingsGradle,
  withAppBuildGradle,
  withDangerousMod,
  createRunOncePlugin,
} = require("expo/config-plugins");
const path = require("path");
const fs = require("fs");

/**
 * Expo config plugin to embed the Wear OS watch app into the Android build.
 *
 * This plugin does three things during prebuild:
 * 1. Copies the android-watch/ directory into the Android project as a module
 * 2. Adds include ':android-watch' to settings.gradle
 * 3. Adds wearApp project(':android-watch') to app/build.gradle dependencies
 *
 * When built and uploaded to Google Play, the embedded Wear OS APK will
 * auto-install on paired watches.
 */

function copyDirSync(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  const entries = fs.readdirSync(src, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyDirSync(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

function withWearOSModule(config) {
  // Step 1: Copy android-watch directory into the Android project
  config = withDangerousMod(config, [
    "android",
    (config) => {
      const projectRoot = config.modRequest.projectRoot;
      const androidRoot = path.join(projectRoot, "android");
      const watchSrc = path.join(projectRoot, "android-watch");
      const watchDest = path.join(androidRoot, "android-watch");

      if (fs.existsSync(watchSrc)) {
        // Remove old copy if present
        if (fs.existsSync(watchDest)) {
          fs.rmSync(watchDest, { recursive: true, force: true });
        }
        copyDirSync(watchSrc, watchDest);

        // Remove the standalone settings.gradle.kts and gradle.properties
        // from the copied module -- the parent project handles this
        const standalonSettings = path.join(
          watchDest,
          "settings.gradle.kts"
        );
        if (fs.existsSync(standalonSettings)) {
          fs.unlinkSync(standalonSettings);
        }
        const standaloneGradleProps = path.join(
          watchDest,
          "gradle.properties"
        );
        if (fs.existsSync(standaloneGradleProps)) {
          fs.unlinkSync(standaloneGradleProps);
        }
      } else {
        console.warn(
          "[withWearOS] android-watch/ directory not found at",
          watchSrc
        );
      }

      return config;
    },
  ]);

  // Step 2: Add include ':android-watch' to settings.gradle
  config = withSettingsGradle(config, (config) => {
    if (config.modResults.language === "groovy") {
      const contents = config.modResults.contents;
      if (!contents.includes("':android-watch'")) {
        config.modResults.contents =
          contents + "\ninclude ':android-watch'\n";
      }
    }
    return config;
  });

  // Step 3: Add wearApp dependency to app/build.gradle
  config = withAppBuildGradle(config, (config) => {
    if (config.modResults.language === "groovy") {
      const contents = config.modResults.contents;
      if (!contents.includes("wearApp")) {
        // Insert wearApp dependency into the dependencies block
        config.modResults.contents = contents.replace(
          /dependencies\s*\{/,
          `dependencies {\n    wearApp project(':android-watch')`
        );
      }
    }
    return config;
  });

  return config;
}

module.exports = createRunOncePlugin(withWearOSModule, "withWearOS", "1.0.0");

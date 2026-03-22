const { withProjectBuildGradle } = require("expo/config-plugins");

module.exports = function withAsyncStorageRepo(config) {
  return withProjectBuildGradle(config, (config) => {
    if (config.modResults.language === "groovy") {
      const contents = config.modResults.contents;
      // Add local_repo for @react-native-async-storage/async-storage v3 KMP artifact
      if (!contents.includes("async-storage")) {
        config.modResults.contents = contents.replace(
          /allprojects\s*\{\s*\n\s*repositories\s*\{/,
          `allprojects {
  repositories {
    maven {
      url new File(["node", "--print", "require.resolve('@react-native-async-storage/async-storage/package.json')"].execute(null, rootDir).text.trim(), "../android/local_repo")
    }`
        );
      }
    }
    return config;
  });
};

const { withEntitlementsPlist, withXcodeProject, withInfoPlist } = require("@expo/config-plugins");

function withHealthKit(config) {
  // Add HealthKit entitlements
  config = withEntitlementsPlist(config, (config) => {
    config.modResults["com.apple.developer.healthkit"] = true;
    config.modResults["com.apple.developer.healthkit.access"] = ["health-records"];
    return config;
  });

  // Add HealthKit usage descriptions to Info.plist
  config = withInfoPlist(config, (config) => {
    config.modResults.NSHealthShareUsageDescription =
      config.modResults.NSHealthShareUsageDescription ||
      "Estou Bem usa dados de saúde para monitorar o bem-estar do idoso e alertar familiares.";
    config.modResults.NSHealthUpdateUsageDescription =
      config.modResults.NSHealthUpdateUsageDescription ||
      "Estou Bem registra check-ins de saúde para acompanhamento familiar.";
    return config;
  });

  // Add HealthKit framework and capability to Xcode project
  config = withXcodeProject(config, (config) => {
    const project = config.modResults;
    const targetName = "EstouBem";

    // Find the main target
    const targets = project.pbxNativeTargetSection();
    for (const key in targets) {
      if (typeof targets[key] === "object" && targets[key].name === targetName) {
        // Add HealthKit to system frameworks
        project.addFramework("HealthKit.framework", {
          weak: false,
          target: key,
        });
      }
    }

    return config;
  });

  return config;
}

module.exports = withHealthKit;

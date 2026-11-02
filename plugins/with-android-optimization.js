const { withGradleProperties, withAppBuildGradle } = require('expo/config-plugins');

/** Persist release-only R8 settings across clean Expo prebuilds. */
module.exports = function withAndroidOptimization(config) {
  config = withGradleProperties(config, result => {
    const settings = {
      'android.enableMinifyInReleaseBuilds': 'true',
      'android.enableShrinkResourcesInReleaseBuilds': 'true',
      'android.enableR8.fullMode': 'true',
      'android.r8.optimizedResourceShrinking': 'true',
    };
    result.modResults = result.modResults.filter(entry => !(entry.type === 'property' && Object.hasOwn(settings, entry.key)));
    for (const [key, value] of Object.entries(settings)) result.modResults.push({ type: 'property', key, value });
    return result;
  });
  return withAppBuildGradle(config, result => {
    const current = result.modResults.contents;
    const optimized = current.replace(/getDefaultProguardFile\((['"])proguard-android\.txt\1\)/g,
      'getDefaultProguardFile("proguard-android-optimize.txt")');
    if (!optimized.includes('getDefaultProguardFile("proguard-android-optimize.txt")') &&
        !optimized.includes("getDefaultProguardFile('proguard-android-optimize.txt')")) {
      throw new Error('Android template changed: review the release R8 configuration before building.');
    }
    result.modResults.contents = optimized;
    return result;
  });
};

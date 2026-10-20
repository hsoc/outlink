const { withAndroidManifest, withEntitlementsPlist, withInfoPlist } = require('expo/config-plugins');
/** Local alerts only: no APNs capability, remote wake-up mode, or FCM auto-init. */
module.exports = function withLocalNotifications(config) {
  config = withEntitlementsPlist(config, result => { delete result.modResults['aps-environment']; return result; });
  config = withInfoPlist(config, result => {
    if (Array.isArray(result.modResults.UIBackgroundModes)) result.modResults.UIBackgroundModes = result.modResults.UIBackgroundModes.filter(mode => mode !== 'remote-notification');
    return result;
  });
  return withAndroidManifest(config, result => {
    const application = result.modResults.manifest.application[0];
    const metadata = application['meta-data'] ??= [];
    for (const name of ['firebase_messaging_auto_init_enabled', 'firebase_analytics_collection_enabled']) {
      const item = metadata.find(item => item.$['android:name'] === name);
      if (item) item.$['android:value'] = 'false';
      else metadata.push({ $: { 'android:name': name, 'android:value': 'false' } });
    }
    return result;
  });
};

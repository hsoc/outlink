const identities = require('./config/app-identities.json');

module.exports = ({ config }) => {
  const identity = process.env.EXPO_PUBLIC_APP_ENV === 'development'
    ? identities.development
    : identities.production;
  return {
    ...config,
    name: identity.name,
    scheme: identity.scheme,
    ios: {
      ...config.ios,
      ...(process.env.APPLE_TEAM_ID ? { appleTeamId: process.env.APPLE_TEAM_ID } : {}),
      bundleIdentifier: identity.id,
      // Xcode replaces this with the selected provisioning profile's signed value.
      entitlements: { ...config.ios?.entitlements, 'aps-environment': 'development' },
    },
    android: { ...config.android, package: identity.id },
  };
};

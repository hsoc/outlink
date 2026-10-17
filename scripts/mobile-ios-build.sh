#!/usr/bin/env bash
set -euo pipefail
: "${IOS_CERTIFICATE_BASE64:?Configure an Apple Distribution PKCS12 certificate}"
: "${IOS_CERTIFICATE_PASSWORD:?Configure the certificate password}"
: "${IOS_PROVISION_PROFILE_BASE64:?Configure the Outlink provisioning profile}"
: "${APPLE_TEAM_ID:?Configure your Apple developer team}"
work="$(mktemp -d)"
keychain="$work/build.keychain-db"
password="$(openssl rand -hex 24)"
cleanup() { security delete-keychain "$keychain" >/dev/null 2>&1 || true; rm -rf "$work"; }
trap cleanup EXIT
export OUTLINK_IOS_SIGNING_DIR="$work"
python3 - <<'PY'
import os,base64,pathlib
root=pathlib.Path(os.environ['OUTLINK_IOS_SIGNING_DIR'])
for variable,name in [('IOS_CERTIFICATE_BASE64','certificate.p12'),('IOS_PROVISION_PROFILE_BASE64','profile.mobileprovision')]:
 (root/name).write_bytes(base64.b64decode(os.environ[variable],validate=True))
PY
security create-keychain -p "$password" "$keychain"
security set-keychain-settings -lut 21600 "$keychain"
security unlock-keychain -p "$password" "$keychain"
security import "$work/certificate.p12" -k "$keychain" -P "$IOS_CERTIFICATE_PASSWORD" -T /usr/bin/codesign
security set-key-partition-list -S apple-tool:,apple: -k "$password" "$keychain" >/dev/null
security list-keychains -d user -s "$keychain" "$HOME/Library/Keychains/login.keychain-db"
security cms -D -i "$work/profile.mobileprovision" > "$work/profile.plist"
python3 - <<'PY'
import os,plistlib,pathlib,shutil
root=pathlib.Path(os.environ['OUTLINK_IOS_SIGNING_DIR'])
profile=plistlib.loads((root/'profile.plist').read_bytes());team=os.environ['APPLE_TEAM_ID'];identifier='io.github.hsoc.outlink'
assert profile['TeamIdentifier']==[team], 'Wrong provisioning team'
assert profile['Entitlements']['application-identifier']==team+'.'+identifier, 'Wrong application ID'
directory=pathlib.Path.home()/'Library/MobileDevice/Provisioning Profiles';directory.mkdir(parents=True,exist_ok=True)
shutil.copy(root/'profile.mobileprovision',directory/(profile['UUID']+'.mobileprovision'))
(root/'profile-name').write_text(profile['Name'])
with open(root/'ExportOptions.plist','wb') as f:plistlib.dump({'method':os.environ.get('IOS_EXPORT_METHOD','release-testing'),'teamID':team,'signingStyle':'manual','provisioningProfiles':{identifier:profile['Name']}},f)
PY
npm run ios:prebuild
mkdir -p release
xcodebuild -workspace ios/Outlink.xcworkspace -scheme Outlink -configuration Release -destination 'generic/platform=iOS' -archivePath "$PWD/release/Outlink.xcarchive" DEVELOPMENT_TEAM="$APPLE_TEAM_ID" CODE_SIGN_STYLE=Manual PROVISIONING_PROFILE_SPECIFIER="$(cat "$work/profile-name")" archive
xcodebuild -exportArchive -archivePath "$PWD/release/Outlink.xcarchive" -exportPath "$PWD/release/ios" -exportOptionsPlist "$work/ExportOptions.plist"

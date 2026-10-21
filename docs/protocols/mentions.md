# Mentions and local notifications

In Public Mesh and public location channels, tap a received sender name to append
a qualified mention such as `@Alice#7a2f`. Names with spaces/punctuation use
braces, for example `@{Alice Smith#7a2f}`. Display suffixes come from the relevant
public identity; see [nicknames](display-names.md). No incompatible wire field or
remote service is added: mentions remain plain text to all clients.

Matching uses the saved base nickname, Unicode NFC normalization and
case-insensitive matching. A qualified mention must match a local identity suffix;
a different suffix does not trigger bare-name matching. Mesh candidates recognize
the local mesh identity and current bridge identity; location candidates use the
current channel identity. Legacy bare mentions still match the base and may notify
multiple devices with that nickname. Identity rotation changes the suffix; use a
recent sender label. Partial words and email addresses do not match. A rename
affects future alerts, without rewriting history. Public received bubbles mentioning
you have an accent outline and Mentioned you label even with notifications disabled.

Enable **Settings → Notify when mentioned** and grant OS notification permission.
It defaults off and applies to both public chat types. Private-message alerts
are not part of this setting. Permission denial does not silently enable it;
message receipt and visual highlighting continue independently.

Alerts are local OS notifications generated after a message reaches the running
app. Previews contain only Outlink and a generic mesh/location mention notice;
no sender name, nickname, message text or area code is included. OS permission,
channel sound settings, Do Not Disturb and OS presentation policies still apply.
A notification opens the application; it does not automatically reconnect or
join another channel.

Android can receive while backgrounded only when the existing background
connectivity mode retains a joined mesh and its connections. Location-only
sessions still pause. iOS currently pauses its JavaScript messaging engine in the
background. Neither platform gains delivery after force-stop/process death or
remote wake-up through this feature. A fresh native APK/IPA build is required.

Only new incoming public messages no more than 90 seconds old (up to 60 seconds
of future clock skew) are candidates. History restoration, private messages,
self messages, blocked mesh peers, duplicate relay/radio events, and stale replay
do not trigger alerts. Candidate processing is serial, bounded to 32 queued
items and 512 deduplication keys, and rate-limited to one alert per ten seconds
across channels. Additional alerts inside that window are suppressed; their
messages and highlights remain visible. Native failures never discard a message.

Disabling the option drains pending submissions and attempts to clear only mention alerts,
preserving the Android connectivity notification. Failed native cleanup does not
restore the disabled preference. Identity wipe invalidates
pending candidates, waits for pending submissions, and attempts native alert
cleanup before erasing preferences/data. A native cleanup failure does not block
identity/key erasure. Local notification bodies are intentionally generic.

The platform port owns permissions, presentation and cleanup. Chat services pass
new incoming messages to the shared mention service; UI owns translated copy.
Only selected local Expo notification APIs are imported, avoiding its barrel's
remote token registration effects. A configuration plugin removes APNs and remote
notification background mode and disables FCM/analytics automatic initialization.
No push tokens are requested or uploaded and no push backend is configured.

Automated checks cover matching boundaries/Unicode, both live receive paths,
permission denial, opt-out, deduplication, rate limits, stale/history exclusions,
wipe races, local Android/iOS scheduling, cleanup isolation, and generated native
configuration. Physical-device/native notification behavior remains unverified.

## Tap a message to mention its sender

Tap received message text in Public Mesh, location channels, private conversations
or private Bluetooth groups to append the sender mention to the current draft and
focus the message box. Existing draft text is preserved; tapping does not send.
The mention uses the visible nickname, including its four-character discriminator
only for active duplicates. Long-press remains available for text selection.
Tapping your own messages does not insert a mention. Public sender labels retain
their existing shortcut. This does not enable private/group mention notifications.

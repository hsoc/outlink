# Focused security review — 2026-10-20

Reviewed baseline `4f45ac4e37aa3b7010aeb73263a80fbaa8f1936c` and the fixes
below. This is a focused source review, not a security certification.

## Fixed findings

### Background service failure could prevent identity erasure (moderate)

`panicWipe` awaited native background-service shutdown before stopping transports
and deleting local data. A rejected native call aborted the entire operation,
leaving the identity and encrypted history on the device despite a wipe attempt.
Native service/notification shutdown is now best effort, as mention notification
cleanup already was. Transport shutdown and serialized storage/key deletion still
run and actual storage failures still reject the wipe, allowing an explicit retry.
A background-service error can leave its OS notification/service present; this
change does not guarantee native cleanup when the OS rejects it.

Regression coverage injects native service rejection and verifies successful
local erasure. Existing deletion-failure/retry coverage remains passing.

### Relay close failure could retain channel key in memory (low)

`GeohashSession.stop` closed sockets before clearing the signing key, rejecting
pending sends, and reporting disconnection. One throwing native socket close
skipped that cleanup and the remaining relays. Each close is now isolated after
callbacks have been detached. Remaining sockets, timers, pending sends, presence
state and the key are cleaned even if a close throws. This also protects the
location-channel shutdown used during erasure. A native socket may remain open
if its close operation fails, but its handlers are detached and the session is
stopped; the application no longer processes its frames.

Regression coverage injects a close exception with an outstanding send and
checks key zeroing, rejection, other-socket cleanup and timer cancellation.

## Other reviewed controls and remaining limits

Inspected BLE packet length/decompression bounds, fragment quotas and identity
matching; public relay input limits, signature/channel validation and replay
windows; private envelope signature/sender binding; prekey storage and consumption;
channel migration proofs; authenticated local encryption and secure-store policy;
and mention notification permission, replay/rate limits and erasure invalidation.
No additional concrete vulnerability was established in these inspected paths.
This does not establish exhaustive protocol, cryptographic or native safety.

The production dependency audit remains **43 findings: 27 high, 16 moderate,
0 critical**. Direct advisory-bearing transitive packages include braces,
node-forge, decode-uri-component, sprintf-js and uuid; parent packages are also
counted. These are dependency-tree findings, not 43 independently demonstrated
application exploits. Automated recommendations include incompatible Expo/React
Native version changes; no automatic fixes or unrelated upgrades were applied.
See [dependency review](dependency-review.md) for previous investigation.

Transport shutdown errors still fail the wipe before deletion: deleting while
undrained transport/storage work can write again is not treated as safe. Native
calls that never settle can also stall cleanup; no arbitrary timeout was added
that would claim completed erasure while work remains active. Local deletion is
not forensic secure erasure of backups, flash remnants or recipients' copies.
Public nicknames remain non-unique and unauthenticated labels. Public channels
remain public; their relay operators can observe connections and channel activity.

## Validation

- 230 Jest tests passed across 38 suites, including both new failure regressions.
- TypeScript checks and Expo lint passed.
- Fresh `npm audit --omit=dev --json` completed with the unresolved counts above
  (nonzero exit status is expected for findings).
- No dependency, native configuration or UI changes. Native builds and physical
  device testing were not performed; physical testing remains omitted by request.

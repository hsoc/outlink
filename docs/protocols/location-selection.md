# Location-channel selection

Tap Region, City, or District to request foreground location and immediately fill
its geohash at precision 3, 4, or 5 respectively. There is no separate Use my
location action. These are approximate grid sizes, not administrative boundaries.
A failed location request leaves the previous code and selection unchanged.
Only the resulting area code is persisted; coordinates are not sent to relays.
An outstanding result is discarded after identity erasure or screen unmount.

Use Change area from an existing channel to reopen these controls; Cancel keeps
the current conversation visible. Joining applies the new code.

Alternatively, edit Area code and tap Join or the keyboard submit action. Custom
codes require no location permission. Input accepts an optional leading #,
case-insensitive geohash base32, and 1–12 characters after normalization. Invalid
codes show an inline error and cannot join. Editing clears the preset selection.
Selecting a preset fills the code but does not join or switch a live channel.
Public name shares the saved default and editing behavior documented in
[display names](display-names.md).

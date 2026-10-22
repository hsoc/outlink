# Location-channel selection

Tap a preset to request foreground location and immediately fill its geohash:

| Preset | Characters | Approximate grid width |
| --- | --- | --- |
| Region | 3 | 156 km |
| City | 4 | 39 km |
| District | 5 | 4.9 km |
| Neighborhood | 6 | 1.2 km |
| Block | 7 | 153 m |

Button sizes describe the widest case near the equator; east–west widths shrink
with latitude. They are not radii, Bluetooth ranges, or administrative boundaries.
Geohash cells can be rectangular: for example a six-character cell is roughly
1.2 km wide by 0.61 km high at the equator. See the
[OpenSearch geohash dimensions](https://docs.opensearch.org/latest/aggregations/bucket/geohash-grid/#geohash-precision).

Every preset derives both its selected code and a six-character Neighborhood code
from one location fix. The Neighborhood code fills an empty bridge-area field,
even when Region, City, or District was selected; its suffix is never guessed.
Existing bridge codes, including custom codes and active bridge areas, are kept.
Clear the bridge field and select a preset again to fill it for a new location.
This does not enable bridging or change an active bridge route. Automatic relay
selection still only chooses relay servers.

There is no separate Use my location action. A failed location request leaves the
previous codes and selection unchanged. Only the resulting area codes are
persisted; coordinates are not sent to relays. An outstanding result is discarded
after identity erasure or screen unmount.

Tap **#area** in an existing conversation to reopen these controls; Cancel keeps
the current conversation visible. Joining applies the new code.

Alternatively, edit Area code and tap Join or the keyboard submit action. Custom
codes require no location permission. Input accepts an optional leading #,
case-insensitive geohash base32, and 1–12 characters after normalization. Invalid
codes show an inline error and cannot join. Editing clears the preset selection.
Selecting a preset fills the code but does not join or switch a live channel.
The header nickname shares the saved default and editing behavior documented in
[display names](display-names.md).

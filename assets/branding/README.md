# App artwork

`logo-original.png` is the maintainer-supplied 1254×1254 RGB PNG, retained byte for
byte. The maintainer explicitly requested keeping the image exactly as supplied,
including the “bitchat” lettering. Do not substitute generated lettering or redraw
the mark. Native launcher masks may still change the outer canvas shape.

Platform assets are resized copies, without cropping or recoloring. The Android
foreground has additional white padding to protect the speech-bubble tail and
lettering inside launcher masks. The retired monochrome icon is removed rather
than displaying the former logo for themed icons. No custom monochrome variant is
supplied, so themed-icon presentation depends on the launcher.

Regenerate from the repository root with ImageMagick 7:

```sh
magick assets/branding/logo-original.png -resize 1024x1024 -strip assets/images/icon.png
magick assets/branding/logo-original.png -resize 800x800 -background white -gravity center -extent 1024x1024 -strip assets/images/android-icon-foreground.png
magick assets/branding/logo-original.png -resize 600x600 -strip assets/images/splash-icon.png
```

`app.json` selects the iOS/app icon and Android adaptive foreground; both in-app
header controls reuse `icon.png`. The splash configuration uses the supplied mark
on white on Android and iOS. Asset/config changes require a new native build;
existing published APKs do not change.

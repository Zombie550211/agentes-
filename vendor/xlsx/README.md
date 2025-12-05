This folder is intended to hold the SheetJS (xlsx) UMD bundle used for client-side Excel/CSV parsing.

Please download a compatible version (e.g. xlsx.full.min.js v0.18.x) and place it here as:

  public/vendor/xlsx/xlsx.full.min.js

The client-side code in `Costumer.html` will try to load this local file first and will fall back to the CDN `https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js` if the local file is not present.

Why a local copy?
- Some browsers block CDN resources due to tracking-prevention policies. Hosting the file locally avoids that.

Recommended download link (open-source):
- https://cdnjs.com/libraries/xlsx

After placing the file, restart your server so the static file is served by Express (if you have server caching, reload it).

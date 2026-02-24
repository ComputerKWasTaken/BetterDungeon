# Firefox Installation Instructions

## Converting from Chrome to Firefox

This extension has been successfully converted from Chrome to Firefox compatibility.

## Key Changes Made

### 1. Manifest Version
- Changed from `manifest_version: 3` to `manifest_version: 2`
- Firefox still primarily uses Manifest V2, while Chrome is moving to V3

### 2. Browser Action
- Changed from `action` to `browser_action` for Firefox compatibility

### 3. Web Accessible Resources
- Simplified format for Manifest V2 compatibility
- Removed the object wrapper and matches array

### 4. API Compatibility
- Added `browser-polyfill.js` for cross-browser compatibility
- Replaced all `chrome.*` API calls with `browser.*` equivalents
- Updated storage, tabs, runtime, and messaging APIs

### 5. Permissions
- Added `tabs` permission for Firefox compatibility

## Installation in Firefox

### Method 1: Temporary Installation (Development)
1. Open Firefox
2. Navigate to `about:debugging`
3. Click "This Firefox" in the left sidebar
4. Click "Load Temporary Add-on..."
5. Select the `manifest.json` file from this extension folder
6. The extension will be installed temporarily until Firefox restarts

### Method 2: Permanent Installation
1. Package the extension as a ZIP file (excluding .git folder)
2. Open Firefox
3. Navigate to `about:addons`
4. Click the gear icon and select "Install Add-on From File..."
5. Select the ZIP file
6. Confirm installation

## Testing

After installation:
1. Navigate to AI Dungeon (https://play.aidungeon.com/)
2. Click the BetterDungeon icon in the toolbar
3. Verify all features work as expected
4. Test popup functionality, storage, and content script features

## Notes

- The extension uses Manifest V2 which is fully supported in Firefox
- All Chrome-specific APIs have been replaced with Firefox-compatible alternatives
- The browser polyfill ensures compatibility between browsers
- No functionality should be lost in the conversion

## Troubleshooting

If the extension doesn't work:
1. Check the Firefox Browser Console for errors (Ctrl+Shift+J)
2. Verify the manifest.json is valid
3. Ensure all file paths in the manifest are correct
4. Make sure the browser-polyfill.js is loaded first in all scripts

# FreeShow+ for Apple Silicon

Target: Apple Silicon Macs, including the church M3 with 16 GB RAM.
Repository: https://github.com/jeppahilga-rgb/Freeshow-dmg

The expanded native DMG passed Apple Silicon cloud verification on 16 October 2026 (build 38906835115, packaging 38909497845). The capture corrections from the same day's re-audit require their own successful build. A successful build proves compilation and the listed automated checks; it does not prove camera permissions, real-time performance, external displays or physical hardware operation.

## Native ports implemented

- Editing, local libraries, Scripture/output selection, bundled fonts, ordinary media, phone-camera WebRTC and Window outputs retain the shared implementation.
- ScreenCaptureKit captures windows and displays at physical pixel resolution. Live frames keep full source resolution; only source-picker thumbnails are reduced. Streams close when their last consumer closes and their helper exits if the editor terminates. Network output capture changes the ScreenCaptureKit frame interval when its consumer frame rate changes.
- Shared website sources use WKWebView snapshots. Back/forward state uses WebKit's native navigation history. Website controls stay separate from the audience output.
- CoreMIDI input/output supports the same notes, control changes, channels and listener IDs as Windows. A virtual MIDI loopback test exercises native delivery without a physical keyboard.
- The embedded, checksum-verified MediaMTX 1.21.2 ARM64 receiver provides short RTMP camera addresses ending in /cam. No separate MediaMTX installation is required.
- NDI, OMT, Blackmagic, timecode, Opus audio, offline speech and presentation-control modules are built or selected for ARM64, copied with dependencies/notices, checked for unresolved library paths and imported from the staged runtime.
- NDI/OMT/Blackmagic/RTMP/WHIP output transport takes BGRA frames from ScreenCaptureKit into the shared backend. Actual devices and receiving applications still need testing.
- PDF export uses WebKit's macOS print operation with pagination and a PDF save destination, without showing a printer dialog.
- Account credentials use authenticated AES-GCM encryption with a random key stored in macOS Keychain. There is no plaintext fallback. Windows DPAPI credentials cannot be transferred: reconnect accounts on the Mac. The cloud check creates and deletes an isolated Keychain fixture.
- Spelling uses NSSpellChecker, including supported languages, suggestions and adding a word.
- Escape/double-click output recovery remains available. Command+Shift+F12 closes all outputs globally (Fn may also be needed on keyboards configured for media keys).
- Editable PPTX import requires no Office installation. PDF-style PowerPoint conversion can use an installed LibreOffice on macOS; exporting to PDF in PowerPoint is also supported. LibreOffice's rendering can differ from Microsoft Office, especially if fonts are missing.

## Requirements and remaining limitations

- Allow camera, microphone, local network and Screen Recording access when using those features. macOS may require reopening FreeShow+ after Screen Recording permission changes.
- Blackmagic hardware requires the manufacturer's Desktop Video driver. Native presentation control requires PowerPoint or Keynote and macOS Automation permission. FFmpeg can be installed from FreeShow settings for encoding features.
- A standalone FreeShow virtual camera is **not included**. macOS requires a signed camera extension, provisioning and an Apple Developer identity; none have been supplied. The app reports this explicitly instead of offering a start button that cannot work. NDI/OMT or an OBS source remain possible output paths once verified on the target Mac.
- The DMG uses ad-hoc signing. Developer ID signing and Apple notarization require the owner's Apple credentials, kept only in CI secrets. No signing secrets belong in source control.
- ScreenCaptureKit requires a real macOS login session and Screen Recording consent. Cloud headless checks cannot verify protected video, permission dialogs, external cameras, audio-device behavior, projector placement or latency on the church network.
- Window/display capture is video only; it does not capture another application's audio. WKWebView website snapshots and script-based media muting need testing with the actual sites, especially cross-origin embedded players. Native-module imports alone do not verify NDI or other network receivers.

## Build and verification

The manual macos-15 ARM workflow builds the frontend/backend, native modules, Rust application, app bundle and DMG. It verifies ARM architecture, bundled runtime startup and imports, native regression tests, code signatures and disk-image integrity. The final app bundle is checked again for required entitlements, runtime startup and all eight native-module imports. The workflow publishes an expiring Actions artifact; selected verified installers are separately published to this fork's GitHub Releases. Consult the exact run and checksum accompanying each delivered DMG.

Sources and licenses from the original GPL FreeShow project are preserved. Optional runtime packages retain their upstream notices. No production library or account credentials are used by the automated tests.

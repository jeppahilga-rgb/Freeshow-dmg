# FreeShow+ — 1.6.7-beta.1 port

Source: [ChurchApps release](https://github.com/ChurchApps/FreeShow/releases/tag/v1.6.7-beta.1), commit `971b031915e4adafe56771f854409cab12116f13`, compared with our upstream base `98b5e19956ef61fb9df1ca5ae361898def87f63d` (1.6.6).

All 64 changed upstream file entries were reviewed. Shared source changes were merged; package versions were updated while retaining the Tauri dependency set. The dependency lock was reconciled without reinstalling the native modules. Original source copies and merge records are retained in `output/upstream-port-1.6.7-beta.1-backup`.

## Included changes

- Output preview labels live with their previews; Ctrl/Command-wheel changes the preview grid.
- Effects can target selected outputs. Overlay/effect scene visibility and live parameter updates include the beta fixes.
- Missing PDF paths use the existing media locator. Project section data is included in data-link exports.
- Remote show search uses the frontend search implementation.
- Cloud sync/ledger fixes, project-name collision fixes, embedded project images, and context-menu selection fixes were merged.
- Stage progress sizing, video synchronization, dynamic-text template merging, AI/Nemotron adjustments, CCLI metadata handling, and Czech/Spanish/French/Slovenian translations include the upstream changes.
- Website readiness/navigation improvements and audio mute controls were ported to our shared WebView2 source. Mute is an explicit native audio operation, not a reload. Native history reports the current URL and back/forward availability.

## Adaptations for this fork

The screen-stream cleanup merge retains our source-switch generation guard and tracks the live stream independently of the video element. This stops tracks even after that element unbinds.

Native project package handling now skips embedded/remote references when looking for files to bundle/extract; the references themselves remain in the project. This is needed because our Tauri importer/exporter does not run the original Electron package functions.

Electron's offscreen-paint refresh change is present in the shared source. The Tauri output engines continue using Windows Graphics Capture and our existing startup/rollback logic; they do not use Electron's OSR paint API.

FreeShow+ branding/icons, the application data identifier, offline font assets and missing-font prompts, Scripture double-click safety/output checkboxes, virtual-camera/phone/RTMP inputs, and earlier performance/reliability repairs were retained. The old preview-label source file is retained for reference but no longer imported by the preview UI.

## Verification

- 62 frontend tests passed, including website mute dispatch without reload.
- 18 upstream cloud-ledger tests passed; authenticated cloud upload was not exercised.
- 34 native tests passed, including explicit-mute policy and mixed local/embedded/remote project media roundtrip; 3 environment-dependent tests were ignored.
- Beta UI checks passed for effect bindings, imported-show identity, project sections and preview-grid zoom.
- 45 UI screen/viewport checks passed with no page errors or horizontal overflow; 7 output-fit cases passed.
- Scripture output selection, FreeShow+ branding, all 56 bundled font faces and import download prompts passed.
- The supplied PPTX renderer passed: 32 slides, 4,684 items and no page errors. This does not guarantee PowerPoint visual parity.
- Isolated backend imports, real font download/cache reuse, output-start rollback, concurrent transport/WHIP startup, DPAPI storage, and NDI/OMT worker-failure checks passed.

This is a beta port. Physical-device/GPU output checks, authenticated provider/cloud flows and the separate open security/dependency findings in `APP-REAUDIT-2026-10-14.md` remain unverified or unresolved. The port does not establish that every beta fix works end to end on every device. No production library or account connection was changed by these isolated tests.

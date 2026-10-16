# FreeShow+ for Apple Silicon — port preparation

Target repository: https://github.com/jeppahilga-rgb/Freeshow-dmg
Target architecture: aarch64-apple-darwin, including M3 Macs with 16 GB RAM.

Status: Mac core preview under development. Source was uploaded to the repository on 16 October 2026 and the first Apple Silicon cloud diagnostic compiled the JavaScript and identified Windows-only Rust implementations. A DMG is not verified until the preview workflow completes its build, architecture, signature and disk-image checks. It is ad-hoc signed, not Developer ID notarized.

The first preview targets editing, local show/library storage, Scripture, fonts, ordinary media and Window outputs. Native screen/window capture, virtual camera, capture-based NDI/OMT/Blackmagic/RTMP/WHIP outputs, native MIDI, RTMP camera receiver, shared website frame capture, native PDF printing and secure external-account storage are explicitly unavailable. These are not reported as working ports. Camera/file playback and physical output displays still require church-Mac testing.

## Prepared locally

- Manual Mac ARM workflow with frontend tests, native compile/tests, app/DMG packaging, architecture/signature/image checks and a downloadable preview artifact only when all steps succeed. It publishes no release automatically.
- windows-capture is now a Windows-target dependency rather than an unconditional dependency.
- Backend resource lookup handles the Mac app Resources directory and selects `node` instead of `node.exe`. Unix backend startup uses a separate process group with cleanup; Windows retains its job object.
- Desktop tool lookup includes Homebrew locations on macOS. File/URL opening uses the platform opener, and memory reporting parses the system page size instead of assuming the Windows layout. Windows shell fullscreen policy is conditionally compiled.
- scripts/audit-macos-readiness.mjs inventories the remaining native platform work. This is an inventory, not proof of compilation.
- `scripts/export-macos-source.mjs` prepares a source ZIP with per-file hashes and checks for common credential patterns. It excludes user libraries, generated binaries and build output. This does not replace a complete secret review before publishing.

## Work needed before a DMG is usable

1. Separate Windows implementations and add macOS implementations or clearly unavailable feature paths for capture, shared website rendering, virtual camera, MIDI, output engines, PDF export and spelling.
2. Replace Windows process job ownership, executable lookup and .exe paths in the Node/backend and MediaMTX runtimes. Stage ARM64 Node, required native modules, notices and the darwin-arm64 MediaMTX binary inside the app resources.
3. Add macOS library locations, Keychain-backed secrets, camera/microphone permissions and proper output-window lifecycle behavior. Preserve all editor, Scripture, font and import changes from this fork.
4. Compile on the cloud runner and fix actual macOS compiler errors. Run core startup/editor/output checks there before enabling app/DMG packaging.
5. Package the working app as a DMG, optionally with Developer ID signing and notarization using GitHub repository secrets. Signing credentials must never be committed.
6. Test installation, camera/microphone permissions, output displays and media features on the church Mac. A successful cloud build does not prove hardware playback or low latency.

GitHub's authenticated connection is needed to publish the source and dispatch/inspect cloud runs. Do not share passwords or tokens in chat. Publishing should use a clean source snapshot, excluding user libraries, credentials, generated binaries and local build output; preserve GPL attribution and bundled dependency notices.

References:
- https://docs.github.com/en/actions/reference/runners/github-hosted-runners
- https://v2.tauri.app/distribute/pipelines/github/
- https://v2.tauri.app/distribute/macos-application-bundle/

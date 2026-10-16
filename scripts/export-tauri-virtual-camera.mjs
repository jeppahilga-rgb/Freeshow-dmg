import fs from 'node:fs/promises'
import path from 'node:path'
import crypto from 'node:crypto'
const destination = path.resolve('../output/FreeShow-Virtual-Camera')
await fs.mkdir(destination, { recursive: true })
const exe = await fs.readFile('src-tauri/target/release/freeshow-tauri.exe')
const acl = await fs.stat('src-tauri/permissions/editor.toml')
const rtmpSource = await fs.stat('src-tauri/src/rtmp_input.rs')
const release = await fs.stat('src-tauri/target/release/freeshow-tauri.exe')
for (const name of await fs.readdir('src-tauri/src',{recursive:true})) {
  const file=path.join('src-tauri/src',name),stat=await fs.stat(file)
  if(stat.isFile()&&stat.mtimeMs>release.mtimeMs)throw Error('Rebuild native executable after updating '+file)
}
if (release.mtimeMs < Math.max(acl.mtimeMs, rtmpSource.mtimeMs)) throw Error('Rebuild native executable after updating RTMP input or command permissions')
if (!exe.includes(await fs.readFile('src-tauri/src/shared_website.js'))) throw Error('Missing current website script')
const frontend = (await fs.readdir('dist-tauri/assets')).find(name => /^index-.*\.js$/.test(name))
if (!frontend || !exe.includes(Buffer.from(frontend))) throw Error('Missing current frontend')
if (!exe.includes(await fs.readFile('src-tauri/mediamtx/mediamtx.exe'))) throw Error('Missing bundled MediaMTX')
await fs.copyFile('src-tauri/mediamtx/LICENSE', path.join(destination, 'LICENSE-MediaMTX.txt'))
await fs.copyFile('LICENSE', path.join(destination, 'LICENSE-FreeShow.txt'))
await fs.copyFile('APP-AUDIT-REPAIRS.md', path.join(destination, 'APP-AUDIT-REPAIRS.md'))
await fs.copyFile('AUDIT-FIXES-2026-10-15.md', path.join(destination, 'AUDIT-FIXES-2026-10-15.md'))
await fs.copyFile('EDITOR-DRAG-REPAIR.md', path.join(destination, 'EDITOR-DRAG-REPAIR.md'))
await fs.copyFile('LYRICS-SEARCH-REPAIR.md', path.join(destination, 'LYRICS-SEARCH-REPAIR.md'))
await fs.copyFile('EDITOR-ZOOM-REPAIR.md', path.join(destination, 'EDITOR-ZOOM-REPAIR.md'))
await fs.copyFile('node_modules/dompurify/LICENSE', path.join(destination, 'LICENSE-DOMPurify.txt'))
await fs.copyFile('node_modules/svelte/LICENSE.md', path.join(destination, 'LICENSE-Svelte.txt'))
await fs.copyFile('BUNDLED-FONTS.md', path.join(destination, 'BUNDLED-FONTS.md'))
await fs.copyFile('UPSTREAM-1.6.7-BETA-PORT.md', path.join(destination, 'UPSTREAM-1.6.7-BETA-PORT.md'))
await fs.copyFile('WINDOWS-CAPTURE-QUALITY.md', path.join(destination, 'WINDOWS-CAPTURE-QUALITY.md'))
await fs.copyFile('OUTPUT-ESCAPE-REPAIR.md', path.join(destination, 'OUTPUT-ESCAPE-REPAIR.md'))
await fs.copyFile('src-tauri/mediamtx/UPSTREAM.json', path.join(destination, 'MediaMTX-UPSTREAM.json'))
await fs.writeFile(path.join(destination, 'FreeShow-Tauri-Virtual-Camera.exe'), exe)
await fs.copyFile('src-tauri/icons/icon.ico', path.join(destination, 'FreeShowPlus.ico'))
const root = 'src-tauri/virtual-camera/'
for (const [source, target] of [
  ['build/FreeShowVirtualCamera.dll', 'FreeShowVirtualCamera.dll'],
  ['build/FreeShowCameraTool.exe', 'FreeShowCameraTool.exe'],
  ['Install-FreeShowCamera.ps1', 'Install-FreeShowCamera.ps1'],
  ['Uninstall-FreeShowCamera.ps1', 'Uninstall-FreeShowCamera.ps1'],
  ['LICENSE-Microsoft.txt', 'LICENSE-Microsoft.txt'],
  ['deps/wil/LICENSE', 'LICENSE-WIL.txt'],
  ['UPSTREAM-COMMIT.txt', 'UPSTREAM-COMMIT.txt']
]) await fs.copyFile(root + source, path.join(destination, target))
await fs.writeFile(path.join(destination, 'README.txt'), `FreeShow+ — community fork of FreeShow by ChurchApps — Windows 11 x64

This preview bundles 52 original backend handlers and their Node runtime.
Upstream 1.6.7-beta.1 source changes are included; see UPSTREAM-1.6.7-BETA-PORT.md.
Live window/screen capture preserves source pixels. For browser video that stops
when covered, use Open capture browser in the Windows input list.
See WINDOWS-CAPTURE-QUALITY.md for verification and remaining limits.
Double-click/Escape dismiss output windows; Ctrl+Shift+F12 stops all output windows.
See OUTPUT-ESCAPE-REPAIR.md for recovery behavior and verification limits.
13 Google Font families are bundled for offline use. Imported PPTX/show files
offer downloads for missing Google Fonts. See BUNDLED-FONTS.md.
App-wide audit repairs: output startup rollback and concurrency, visible
sender errors, bounded backend replies, non-MP4 codec/subtitle inspection,
font fallback, image-probe reduction, PDF error cleanup, hardware capture
geometry, and a running-app check before installer file replacement.
See APP-AUDIT-REPAIRS.md for evidence, dependencies, and remaining checks.
Scripture output selection: tick Center, Side, or another enabled output
in the wide toolbar above the Scripture picker. The choice is saved with
Scripture settings and applies to verses and the Scripture template background.
Click "Scripture outputs" to show or hide the checkbox row. Hiding the row
preserves the selected outputs. The visibility choice is also remembered.
Unticking all outputs prevents Scripture from being displayed.
Scripture click safety: double-click displays, including when a verse is
already live. Ordinary clicks select a verse for preview. Single-click display
is not available. The Display button and deliberate keyboard shortcuts still work.
Changing the selection affects subsequent displays; it does not clear content
already displayed on a screen that was deselected.
New ports include content-provider connections, AI engines, timecode, cloud
services, MIDI, binary imports, recording, PDF/image export, NDI/OMT,
Blackmagic, RTMP and WHIP output paths. Command coverage is not a promise
that every account or device has been verified.

Verified: 78 bridge tests, 18 cloud-ledger tests, 72 UI viewport/screen checks, 42 native tests, NDI/OMT sender/receiver and
reconnect tests, silent-slide RTMP publishing/decoding, WHIP mono audio and video through
MediaMTX, authenticated WHIP signaling and cleanup, protected-media ranges,
Windows DPAPI credential storage, and packaged native-module loading.
Three native tests were skipped in the normal suite; the supplied PPTX
extraction test was run separately and passed. Codec/subtitle inspection
of non-MP4 media requires the full FFmpeg/FFprobe toolset.

Still requires verification: physical Blackmagic and MIDI hardware,
external provider/cloud/AI accounts, WHIP audio, full native PDF/image
exports and presentation control. Automatic updating requires a Tauri
release feed and signing configuration and is not ported in this preview.
NDI SDK and runtime notices are included under runtime/licenses.
FFmpeg is resolved from the PC or downloaded using the app's existing
Settings action; no FFmpeg binary is bundled in this installer.
Source: ChurchApps/FreeShow plus the local upstream source workspace.
FreeShow is distributed under the included GPL-3.0 license.

RTMP camera input and Virtual Camera

RTMP input: Media > Inputs > RTMP camera input. Copy the full RTMP address.
Connect the camera and PC to the same Wi-Fi, then paste the address into
DJI Mimo > Livestream > RTMP and start streaming. Select the RTMP camera card.
For separate encoder fields, expand Connection options for server and stream key.
No separate MediaMTX installation is required. The bundled receiver starts only
on demand and stops when FreeShow closes. Allow its private-network firewall prompt.
H.264 video only; AAC audio is not included in this input.
MediaMTX 1.21.2 is distributed under the included MIT license.
Verified with real synthetic RTMP publishing and 1280x720 WebRTC decoding;
a physical DJI Pocket 3 has not been tested here.


Extract this ZIP first. Close camera receiving applications before installation.
Open an Administrator PowerShell in this extracted folder and run:
  powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\\Install-FreeShowCamera.ps1
Use your normal Windows account with elevation; registration is for that account.
This installs the FreeShow camera component in ProgramData and registers its COM class.
No OBS camera driver or internet service is required.

Run FreeShow-Tauri-Virtual-Camera.exe. Choose Virtual Camera as the output type.
In Settings > Outputs, select that output and start FreeShow Virtual Camera. No monitor is required.
Restart OBS/Zoom or another receiving app and select "FreeShow Virtual Camera".
Enable Windows desktop-app camera access in Privacy settings if necessary.

Output: 1280 x 720, 30 fps, video only. Audio is configured separately in receiving apps.
The camera receives a live output render window positioned outside the connected displays.
Stopped or unavailable output produces black frames. Only one producer may run.
Stop the camera before disabling/reconfiguring its output. Offscreen capture needs end-to-end verification on your GPU.

Uninstall: run Uninstall-FreeShowCamera.ps1 in Administrator PowerShell.
The uninstaller removes camera registration; component files remain for reinstall.

Verified: native media-source sample, frame transport, Rust header layout, UI Start/Stop.
OBS/Zoom device recognition and end-to-end playback require testing after installation.
The component is unsigned. This is an experimental Windows 11 implementation.
Microsoft Windows-Camera source and WIL are distributed under their included MIT licenses.
`)
const files = {}
for (const name of await fs.readdir(destination, { recursive: true })) {
  if (name === 'build.json') continue
  if (!(await fs.stat(path.join(destination, name))).isFile()) continue
  const bytes = await fs.readFile(path.join(destination, name))
  files[name] = { bytes: bytes.length, sha256: crypto.createHash('sha256').update(bytes).digest('hex') }
}
await fs.writeFile(path.join(destination, 'build.json'), JSON.stringify({ builtAt: new Date().toISOString(), frontend, files }, null, 2))
console.log(destination)


import fs from 'node:fs/promises'
import assert from 'node:assert/strict'
const commands=['rtmp_input_start','rtmp_input_stop','rtmp_input_request']
const capability=JSON.parse(await fs.readFile('src-tauri/capabilities/default.json','utf8'))
assert(capability.windows.includes('main')&&capability.windows.includes('output-*'))
assert(capability.permissions.includes('allow-editor-commands'))
const text=await fs.readFile('src-tauri/permissions/editor.toml','utf8')
const allowed=JSON.parse(text.match(/commands\.allow\s*=\s*(\[[^\]]*\])/)[1])
const compiled=JSON.parse(await fs.readFile('src-tauri/gen/schemas/acl-manifests.json','utf8'))['__app-acl__'].permissions['allow-editor-commands'].commands
for(const command of commands){assert(allowed.includes(command),command+' missing from source ACL');assert(compiled.allow.includes(command),command+' missing from generated ACL');assert(!compiled.deny.includes(command))}
assert(!capability.windows.includes('*'),'Do not expose editor services to arbitrary website windows')
console.log('PASS: RTMP Start/Stop/receiver commands are allowed in generated editor/output ACL; arbitrary website windows are excluded.')

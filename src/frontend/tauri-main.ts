import { installTauriBridge } from "./tauri/bridge"
import { installFileDrop } from "./tauri/fileDrop"
import App from "./App.svelte"

await installTauriBridge()
installFileDrop()
new App({ target: document.body })

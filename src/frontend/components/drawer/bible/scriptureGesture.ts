export function displayScriptureGesture(gesture: "click" | "dblclick", modified = false) {
    return !modified && gesture === "dblclick"
}

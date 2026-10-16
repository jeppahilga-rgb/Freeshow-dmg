const pending = new Map<string, { resolve: (superseded: boolean) => void }>()

// Batch synchronous store changes without adding a timer turn before output IPC.
export function hasNewerMicrotask(id: string): Promise<boolean> {
    pending.get(id)?.resolve(true)
    return new Promise(resolve => {
        const job = { resolve }
        pending.set(id, job)
        queueMicrotask(() => {
            if (pending.get(id) !== job) return
            pending.delete(id)
            resolve(false)
        })
    })
}

export function runSlidePlayback(needsActionTurn: boolean, run: () => void) {
    if (needsActionTurn) setTimeout(run)
    else run()
}

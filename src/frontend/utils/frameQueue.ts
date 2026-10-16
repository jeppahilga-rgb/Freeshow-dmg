// Coalesce high-frequency input before doing geometry/layout work.
export function frameQueue<T>(apply: (value: T) => void) {
    let frame: number | undefined
    let pending: { value: T } | undefined
    function flush() {
        if (frame !== undefined) cancelAnimationFrame(frame)
        frame = undefined
        const next = pending
        pending = undefined
        if (next) apply(next.value)
    }
    return {
        push(value: T) {
            pending = { value }
            if (frame === undefined) frame = requestAnimationFrame(flush)
        },
        flush,
        cancel() {
            if (frame !== undefined) cancelAnimationFrame(frame)
            frame = undefined
            pending = undefined
        }
    }
}

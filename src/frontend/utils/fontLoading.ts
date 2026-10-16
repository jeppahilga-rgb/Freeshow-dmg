const fonts = new Map<string, { promise: Promise<boolean>; retryAt: number }>()
export async function loadFontWithFallback(local: () => boolean | Promise<boolean>, fallback: () => boolean | Promise<boolean>): Promise<boolean> {
    try { if (await local()) return true } catch {}
    return await fallback()
}

export function loadFontOnce(key: string, load: () => boolean | Promise<boolean>): Promise<boolean> {
    const cached = fonts.get(key)
    if (cached && Date.now() < cached.retryAt) return cached.promise
    const entry = { promise: Promise.resolve(false), retryAt: Infinity }
    entry.promise = Promise.resolve().then(load).catch(() => false).then(success => {
        entry.retryAt = success ? Infinity : Date.now() + 30000
        return success
    })
    fonts.set(key, entry)
    if (fonts.size > 256) fonts.delete(fonts.keys().next().value)
    return entry.promise
}

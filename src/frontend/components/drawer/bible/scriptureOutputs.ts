export function scriptureOutputTargets(settings: { outputIds?: string[] }, outputs: { id: string; enabled?: boolean; stageOutput?: boolean }[]): string[] | undefined {
    if (!Array.isArray(settings.outputIds)) return undefined
    const selected = new Set(settings.outputIds)
    return outputs.filter(output => output.enabled !== false && !output.stageOutput && selected.has(output.id)).map(output => output.id)
}

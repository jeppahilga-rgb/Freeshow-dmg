<script lang="ts">
    import { outputs, scriptureSettings } from "../../../stores"
    import MaterialCheckbox from "../../inputs/MaterialCheckbox.svelte"
    import MaterialButton from "../../inputs/MaterialButton.svelte"
    $: options = Object.entries($outputs).map(([id, output]) => ({ ...output, id })).filter(output => output.enabled && !output.stageOutput)
    $: active = options.filter(output => output.active).map(output => output.id)
    $: selectedIds = Array.isArray($scriptureSettings.outputIds) ? $scriptureSettings.outputIds : active.length ? active : options.slice(0, 1).map(output => output.id)
    $: choicesShown = $scriptureSettings.showOutputChoices !== false
    function toggle(id: string, checked: boolean) {
        const ids = checked ? [...new Set([...selectedIds, id])] : selectedIds.filter((value: string) => value !== id)
        scriptureSettings.update(settings => ({ ...settings, outputIds: ids }))
    }
</script>

<div class="scripture-routing">
    <MaterialButton small icon={choicesShown ? "arrow_down" : "arrow_right"} title={choicesShown ? "Hide output choices" : "Show output choices"} on:click={() => scriptureSettings.update(settings => ({ ...settings, showOutputChoices: !choicesShown }))}>Scripture outputs</MaterialButton>
    {#if choicesShown}
    <div class="choices" role="group" aria-label="Scripture outputs">
        {#each options as output (output.id)}
            <MaterialCheckbox label={output.name || output.id} checked={selectedIds.includes(output.id)} on:change={(event) => toggle(output.id, event.detail)} small />
        {/each}
    </div>
    {/if}
    <span class="hint guidance">Double-click to display</span>
    {#if !options.some(output => selectedIds.includes(output.id))}
        <span class="hint">Select an enabled output to display Scripture.</span>
    {/if}
</div>

<style>
    .scripture-routing { display: flex; align-items: center; flex-wrap: wrap; gap: 8px; padding: 6px 8px; }
    .hint { font-size: 0.8em; opacity: 0.65; }
    .choices { display: flex; flex-wrap: wrap; gap: 4px; }
    .guidance { margin-left: auto; }
</style>

import type { Cropping, Resolution } from "../../../types/Settings"

export function getOutputCropStyle(crop: Cropping | undefined, slide: Resolution, viewport: Resolution, bounds: Resolution): string {
    const value = (side: keyof Cropping) => Math.max(0, Number(crop?.[side]) || 0)
    const top = value("top"), right = value("right"), bottom = value("bottom"), left = value("left")
    if (!(top || right || bottom || left) || !viewport.width || !viewport.height || !bounds.width || !bounds.height) return ""

    const xScale = viewport.width / bounds.width, yScale = viewport.height / bounds.height
    const availableWidth = Math.max(0, viewport.width - (left + right) * xScale)
    const availableHeight = Math.max(0, viewport.height - (top + bottom) * yScale)
    const scale = Math.min(availableWidth / slide.width, availableHeight / slide.height)
    const width = slide.width * scale, height = slide.height * scale
    const x = left * xScale + (availableWidth - width) / 2
    const y = top * yScale + (availableHeight - height) / 2
    return `width:${width}px;height:${height}px;margin:${y}px ${viewport.width - x - width}px ${viewport.height - y - height}px ${x}px;`
}

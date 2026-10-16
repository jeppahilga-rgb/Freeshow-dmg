export type Position = { left: number; top: number; width: number; height: number }

// DrawingML group coordinates are relative to chOff/chExt, not the slide origin.
export function groupPosition(position: Position, parent: Position | null, child: Position | null): Position {
    if (!parent) return { ...position }
    const scaleX = child?.width ? parent.width / child.width : 1
    const scaleY = child?.height ? parent.height / child.height : 1
    return {
        left: parent.left + (position.left - (child?.left || 0)) * scaleX,
        top: parent.top + (position.top - (child?.top || 0)) * scaleY,
        width: position.width * scaleX,
        height: position.height * scaleY
    }
}

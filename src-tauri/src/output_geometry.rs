#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Rect {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}
pub struct Display {
    pub physical: Rect,
    pub scale: f64,
}
pub fn resolve(
    displays: &[Display],
    requested: Rect,
    selected: Option<usize>,
    auto: bool,
    locked: bool,
    editor_display: Option<usize>,
) -> Rect {
    if displays.is_empty() {
        return requested;
    }
    let selected = selected.filter(|index| *index < displays.len());
    let target = selected.unwrap_or_else(|| {
        if auto && !locked {
            (0..displays.len())
                .find(|index| Some(*index) != editor_display)
                .unwrap_or(0)
        } else {
            displays
                .iter()
                .position(|display| {
                    let r = display.physical;
                    let s = display.scale;
                    let x = requested.x + requested.width / 2.0;
                    let y = requested.y + requested.height / 2.0;
                    x >= r.x / s
                        && x < (r.x + r.width) / s
                        && y >= r.y / s
                        && y < (r.y + r.height) / s
                })
                .unwrap_or(0)
        }
    });
    let display = &displays[target];
    if !locked && (auto || selected.is_some()) {
        return display.physical;
    }
    let scale = display.scale;
    Rect {
        x: requested.x * scale,
        y: requested.y * scale,
        width: requested.width * scale,
        height: requested.height * scale,
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    fn monitors() -> Vec<Display> {
        vec![
            Display {
                physical: Rect {
                    x: 0.0,
                    y: 0.0,
                    width: 3840.0,
                    height: 2160.0,
                },
                scale: 2.0,
            },
            Display {
                physical: Rect {
                    x: -1920.0,
                    y: 0.0,
                    width: 1920.0,
                    height: 1080.0,
                },
                scale: 1.0,
            },
        ]
    }
    #[test]
    fn selected_monitor_uses_physical_origin_and_full_size() {
        let d = monitors();
        assert_eq!(
            resolve(
                &d,
                Rect {
                    x: 0.0,
                    y: 0.0,
                    width: 1920.0,
                    height: 1080.0
                },
                Some(1),
                false,
                false,
                Some(0)
            ),
            d[1].physical
        );
    }
    #[test]
    fn auto_position_avoids_editor_monitor() {
        let d = monitors();
        assert_eq!(
            resolve(&d, d[0].physical, None, true, false, Some(0)),
            d[1].physical
        );
    }
    #[test]
    fn locked_custom_bounds_keep_position_with_dpi_conversion() {
        let d = monitors();
        assert_eq!(
            resolve(
                &d,
                Rect {
                    x: 20.0,
                    y: 30.0,
                    width: 800.0,
                    height: 600.0
                },
                Some(0),
                true,
                true,
                None
            ),
            Rect {
                x: 40.0,
                y: 60.0,
                width: 1600.0,
                height: 1200.0
            }
        );
    }
}

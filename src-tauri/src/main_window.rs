use tauri::plugin::TauriPlugin;
use tauri::{AppHandle, Manager, PhysicalPosition, PhysicalSize, Runtime, WebviewWindow};
use tauri_plugin_window_state::{StateFlags, WindowExt};

const LABEL: &str = "main";
const TITLE_BAR_HEIGHT: i32 = 32;
const MIN_GRAB_WIDTH: i32 = 64;

// No VISIBLE: the quit flow hides the window before exiting, which would save it as hidden.
fn tracked_state() -> StateFlags {
    StateFlags::SIZE | StateFlags::POSITION | StateFlags::MAXIMIZED
}

pub fn state_plugin<R: Runtime>() -> TauriPlugin<R> {
    tauri_plugin_window_state::Builder::new()
        .with_state_flags(tracked_state())
        .with_filter(|label| label == LABEL)
        .skip_initial_state(LABEL)
        .build()
}

pub fn restore_and_show<R: Runtime>(app: &AppHandle<R>) {
    let Some(window) = app.get_webview_window(LABEL) else {
        return;
    };
    if let Err(e) = window.restore_state(tracked_state()) {
        log::warn!("restoring the main window state failed: {e}");
    }
    if let Err(e) = keep_on_screen(&window) {
        log::warn!("placing the main window on screen failed: {e}");
    }
    let _ = window.show();
    let _ = window.set_focus();
}

fn keep_on_screen<R: Runtime>(window: &WebviewWindow<R>) -> tauri::Result<()> {
    if window.is_maximized()? {
        return Ok(());
    }
    let primary = window.primary_monitor()?;
    let areas: Vec<Rect> = primary
        .iter()
        .chain(window.available_monitors()?.iter())
        .map(|m| Rect::from(*m.work_area()))
        .collect();
    let position = window.outer_position()?;
    let size = window.outer_size()?;
    let current = Rect {
        x: position.x,
        y: position.y,
        width: size.width,
        height: size.height,
    };
    if let Some(fixed) = placement(current, &areas) {
        window.set_size(PhysicalSize::new(fixed.width, fixed.height))?;
        window.set_position(PhysicalPosition::new(fixed.x, fixed.y))?;
    }
    Ok(())
}

#[derive(Clone, Copy, Debug, PartialEq)]
struct Rect {
    x: i32,
    y: i32,
    width: u32,
    height: u32,
}

impl From<tauri::PhysicalRect<i32, u32>> for Rect {
    fn from(r: tauri::PhysicalRect<i32, u32>) -> Self {
        Self {
            x: r.position.x,
            y: r.position.y,
            width: r.size.width,
            height: r.size.height,
        }
    }
}

impl Rect {
    fn right(&self) -> i32 {
        self.x.saturating_add_unsigned(self.width)
    }

    fn bottom(&self) -> i32 {
        self.y.saturating_add_unsigned(self.height)
    }

    fn overlap(&self, other: &Rect) -> (i32, i32) {
        let w = self.right().min(other.right()) - self.x.max(other.x);
        let h = self.bottom().min(other.bottom()) - self.y.max(other.y);
        (w.max(0), h.max(0))
    }

    fn title_bar_reachable_on(&self, area: &Rect) -> bool {
        let grip_y = self.y + TITLE_BAR_HEIGHT / 2;
        let (w, _) = self.overlap(area);
        w >= MIN_GRAB_WIDTH && grip_y >= area.y && grip_y < area.bottom()
    }

    fn fits_in(&self, area: &Rect) -> bool {
        self.width <= area.width && self.height <= area.height
    }
}

/// `None` keeps the window where it is; `areas` lists monitor work areas, primary first.
fn placement(window: Rect, areas: &[Rect]) -> Option<Rect> {
    let shared = |a: &Rect| {
        let (w, h) = window.overlap(a);
        i64::from(w) * i64::from(h)
    };
    let mut target = areas.first()?;
    for area in areas {
        if shared(area) > shared(target) {
            target = area;
        }
    }
    let reachable = areas.iter().any(|a| window.title_bar_reachable_on(a));
    if reachable && window.fits_in(target) {
        return None;
    }
    let width = window.width.min(target.width);
    let height = window.height.min(target.height);
    Some(Rect {
        x: target.x + ((target.width - width) / 2) as i32,
        y: target.y + ((target.height - height) / 2) as i32,
        width,
        height,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    const LAPTOP: Rect = Rect {
        x: 0,
        y: 0,
        width: 1920,
        height: 1040,
    };
    const RIGHT_SCREEN: Rect = Rect {
        x: 1920,
        y: 0,
        width: 2560,
        height: 1400,
    };

    fn win(x: i32, y: i32, width: u32, height: u32) -> Rect {
        Rect {
            x,
            y,
            width,
            height,
        }
    }

    #[test]
    fn leaves_a_window_inside_a_screen_alone() {
        assert_eq!(placement(win(100, 80, 1200, 800), &[LAPTOP]), None);
    }

    #[test]
    fn leaves_a_window_on_a_secondary_screen_alone() {
        let areas = [LAPTOP, RIGHT_SCREEN];
        assert_eq!(placement(win(2200, 100, 1600, 1000), &areas), None);
    }

    #[test]
    fn recenters_a_window_left_on_a_disconnected_screen() {
        let fixed = placement(win(2200, 100, 1200, 800), &[LAPTOP]).unwrap();
        assert_eq!(fixed, win(360, 120, 1200, 800));
    }

    #[test]
    fn recenters_a_window_whose_title_bar_is_above_the_screen() {
        let fixed = placement(win(100, -500, 1200, 800), &[LAPTOP]).unwrap();
        assert_eq!(fixed, win(360, 120, 1200, 800));
    }

    #[test]
    fn shrinks_a_window_larger_than_its_screen() {
        let fixed = placement(win(0, 0, 2560, 1400), &[LAPTOP]).unwrap();
        assert_eq!(fixed, LAPTOP);
    }

    #[test]
    fn picks_the_screen_holding_most_of_the_window() {
        let areas = [LAPTOP, RIGHT_SCREEN];
        let fixed = placement(win(1800, -900, 3000, 1000), &areas).unwrap();
        assert_eq!(fixed, win(1920, 200, 2560, 1000));
    }

    #[test]
    fn falls_back_to_the_primary_screen_when_nothing_overlaps() {
        let areas = [RIGHT_SCREEN, LAPTOP];
        let fixed = placement(win(-5000, -5000, 1200, 800), &areas).unwrap();
        assert_eq!(fixed, win(2600, 300, 1200, 800));
    }

    #[test]
    fn no_screens_means_no_change() {
        assert_eq!(placement(win(0, 0, 100, 100), &[]), None);
    }
}

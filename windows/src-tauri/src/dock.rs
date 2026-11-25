// The dock (dock.html, src/dock/): Miku's own strip at the bottom of the
// screen, next to Windows' own taskbar, not instead of it. The apps the user
// pinned launch with a click; the windows that are open show as icons — a
// click focuses them, another click puts them away. The dock's page draws the
// strip; this module is what it draws from and what the clicks call.
//
// The preference (whether the dock lives at the bottom, and what is pinned)
// rides in settings.json as `dock`, like every other preference. The page
// polls `dock_list` while it is on screen; nothing here pushes.

use serde::{Deserialize, Serialize};

/// The dock's own settings block: on/off, and what is pinned to it.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct DockPref {
    /// The dock sits at the bottom of the screen. Off until the user turns it on.
    pub shown: bool,
    /// The apps pinned to the dock, in the order they show. `path` is the exe
    /// (or a document/folder) the launch hands to the Shell.
    pub pins: Vec<DockPin>,
}

/// One pinned app: a name to show, and what to launch.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DockPin {
    pub name: String,
    pub path: String,
}

/// A window the dock shows: the app behind it, its title, its icon as a
/// data URI (the page's CSP takes `img-src data:`), and whether it is put away.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DockWindow {
    /// The window's handle, opaque to the page: handed back on a click.
    pub hwnd: u64,
    pub title: String,
    /// The executable that owns the window — the page groups by it.
    pub exe: String,
    /// The app's icon, "data:image/png;base64,…", when one was found.
    pub icon: Option<String>,
    pub minimized: bool,
}

/// The windows the dock shows. On Linux the dock is launcher-only for now:
/// an empty list, and the page hides that half.
pub fn list_windows() -> Vec<DockWindow> {
    #[cfg(windows)]
    return windows_imp::list_windows();
    #[cfg(not(windows))]
    return Vec::new();
}

/// Puts a window in front: restored first when it was put away. The
/// foreground lock means the switch can be refused — the caller then gets
/// `false` and leaves the dot alone.
pub fn focus_hwnd(hwnd: u64) -> bool {
    #[cfg(windows)]
    return windows_imp::focus_hwnd(hwnd);
    #[cfg(not(windows))]
    {
        let _ = hwnd;
        false
    }
}

/// Puts a window away (its taskbar button keeps it).
pub fn minimize_hwnd(hwnd: u64) {
    #[cfg(windows)]
    windows_imp::minimize_hwnd(hwnd);
}

#[tauri::command]
pub fn dock_list() -> Vec<DockWindow> {
    list_windows()
}

#[tauri::command]
pub fn dock_focus(hwnd: u64) -> bool {
    focus_hwnd(hwnd)
}

#[tauri::command]
pub fn dock_minimize(hwnd: u64) {
    minimize_hwnd(hwnd);
}

/// Launches a pinned app through the Shell, which resolves documents and
/// folders as well as executables.
#[tauri::command]
pub fn dock_launch(path: String) -> Result<(), String> {
    let p = std::path::PathBuf::from(&path);
    if !p.is_absolute() {
        return Err(format!("dock_launch: not an absolute path: {path}"));
    }
    if !p.exists() {
        return Err(format!("dock_launch: nothing at {path}"));
    }
    crate::platform::open_path(&p);
    Ok(())
}

/// The icon's pixels as a PNG data URI — Miku's way of handing a bitmap to a
/// page (the CSP takes `img-src data:`). The `png` crate is already in the
/// tree (through tauri); this only names it.
#[cfg(windows)]
fn icon_png_uri(rgba: &[u8], w: i32, h: i32) -> Option<String> {
    use std::io::Cursor;
    let mut out = Vec::new();
    {
        let mut enc = png::Encoder::new(Cursor::new(&mut out), w as u32, h as u32);
        enc.set_color(png::ColorType::Rgba);
        enc.set_depth(png::BitDepth::Eight);
        let mut writer = enc.write_header().ok()?;
        writer.write_image_data(rgba).ok()?;
    }
    Some(format!("data:image/png;base64,{}", base64_of(&out)))
}

/// Standard base64 — small, local, no crate: icons are a few KB each.
#[cfg(windows)]
fn base64_of(bytes: &[u8]) -> String {
    const CH: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = String::with_capacity(bytes.len().div_ceil(3) * 4);
    for chunk in bytes.chunks(3) {
        let b = [chunk[0], *chunk.get(1).unwrap_or(&0), *chunk.get(2).unwrap_or(&0)];
        let n = (u32::from(b[0]) << 16) | (u32::from(b[1]) << 8) | u32::from(b[2]);
        out.push(CH[(n >> 18) as usize & 63] as char);
        out.push(CH[(n >> 12) as usize & 63] as char);
        out.push(if chunk.len() > 1 { CH[(n >> 6) as usize & 63] as char } else { '=' });
        out.push(if chunk.len() > 2 { CH[n as usize & 63] as char } else { '=' });
    }
    out
}

// ── Windows: the open windows, their icons, and the clicks ──────────────────

#[cfg(windows)]
mod windows_imp {
    use super::{icon_png_uri, DockWindow};

    use windows::core::PWSTR;
    use windows::Win32::Foundation::{CloseHandle, HWND, LPARAM, WPARAM};
    use windows::Win32::Graphics::Dwm::{DwmGetWindowAttribute, DWMWA_CLOAKED};
    use windows::Win32::Graphics::Gdi::{
        DeleteObject, GetDC, GetDIBits, GetObjectW, ReleaseDC, BITMAP, BITMAPINFO,
        BITMAPINFOHEADER, DIB_RGB_COLORS,
    };
    use windows::Win32::Storage::FileSystem::FILE_ATTRIBUTE_NORMAL;
    use windows::Win32::System::Threading::{
        OpenProcess, QueryFullProcessImageNameW, PROCESS_NAME_WIN32,
        PROCESS_QUERY_LIMITED_INFORMATION,
    };
    use windows::Win32::UI::Input::KeyboardAndMouse::{
        keybd_event, KEYBD_EVENT_FLAGS, KEYEVENTF_KEYUP, VK_MENU,
    };
    use windows::Win32::UI::Shell::{
        SHGetFileInfoW, SHFILEINFOW, SHGFI_ICON, SHGFI_LARGEICON, SHGFI_USEFILEATTRIBUTES,
    };
    use windows::Win32::UI::WindowsAndMessaging::{
        EnumWindows, GetClassLongPtrW, GetIconInfo, GetWindowTextLengthW, GetWindowTextW,
        GetWindowLongPtrW, GetWindowThreadProcessId, IsIconic, IsWindow, IsWindowVisible,
        SendMessageTimeoutW, SetForegroundWindow, ShowWindow, DestroyIcon, FlashWindowEx,
        FLASHWINFO, FLASHW_TRAY, GCLP_HICON, GCLP_HICONSM, GWL_EXSTYLE, HICON, ICONINFO,
        ICON_BIG, ICON_SMALL, SMTO_ABORTIFHUNG, SW_MINIMIZE, SW_RESTORE, WM_GETICON,
        WS_EX_TOOLWINDOW,
    };

    /// The title bar's text; empty for the windows that have none.
    unsafe fn title_of(hwnd: HWND) -> String {
        let len = GetWindowTextLengthW(hwnd);
        if len <= 0 {
            return String::new();
        }
        let mut buf = [0u16; 512];
        let n = GetWindowTextW(hwnd, &mut buf);
        String::from_utf16_lossy(&buf[..n as usize])
    }

    /// The exe the window's process runs, via its pid (spotify.rs's approach).
    unsafe fn exe_of(pid: u32) -> String {
        let Ok(process) = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid) else {
            return String::new();
        };
        let mut buf = [0u16; 1024];
        let mut len = buf.len() as u32;
        let named = QueryFullProcessImageNameW(process, PROCESS_NAME_WIN32, PWSTR(buf.as_mut_ptr()), &mut len);
        let _ = CloseHandle(process);
        if named.is_ok() {
            String::from_utf16_lossy(&buf[..len as usize])
        } else {
            String::new()
        }
    }

    /// The app's icon as a PNG data URI: the window's own icon when it has
    /// one, else the exe file's first icon, read without loading the exe.
    /// `owned` marks the one kind of icon this fn may destroy: the one
    /// SHGetFileInfoW handed out. The window's and the class's icons are
    /// theirs — destroying those would take the icon away from its owner.
    unsafe fn icon_of(hwnd: HWND, exe: &str) -> Option<String> {
        let mut hicon = HICON(std::ptr::null_mut());
        let mut owned = false;
        let mut result: usize = 0;
        for wparam in [ICON_BIG, ICON_SMALL] {
            SendMessageTimeoutW(hwnd, WM_GETICON, WPARAM(wparam as usize), LPARAM(0), SMTO_ABORTIFHUNG, 200, Some(&mut result));
            if result != 0 {
                hicon = HICON(result as *mut _);
                break;
            }
        }
        if hicon.0.is_null() {
            let c = GetClassLongPtrW(hwnd, GCLP_HICON);
            if c != 0 {
                hicon = HICON(c as *mut _);
            }
        }
        if hicon.0.is_null() {
            let c = GetClassLongPtrW(hwnd, GCLP_HICONSM);
            if c != 0 {
                hicon = HICON(c as *mut _);
            }
        }
        if hicon.0.is_null() && !exe.is_empty() {
            let wide: Vec<u16> = exe.encode_utf16().chain([0]).collect();
            let mut info = SHFILEINFOW::default();
            if SHGetFileInfoW(
                windows::core::PCWSTR(wide.as_ptr()),
                FILE_ATTRIBUTE_NORMAL,
                Some(&mut info),
                std::mem::size_of::<SHFILEINFOW>() as u32,
                SHGFI_ICON | SHGFI_LARGEICON | SHGFI_USEFILEATTRIBUTES,
            ) != 0
            {
                hicon = info.hIcon;
                owned = true;
            }
        }
        if hicon.0.is_null() {
            return None;
        }
        let bits = icon_bits(hicon);
        if owned {
            let _ = DestroyIcon(hicon);
        }
        bits.and_then(|(rgba, w, h)| icon_png_uri(&rgba, w, h))
    }

    /// The icon's pixels, read out of its colour bitmap, top-down BGRA.
    unsafe fn icon_bits(hicon: HICON) -> Option<(Vec<u8>, i32, i32)> {
        let mut info = ICONINFO::default();
        if GetIconInfo(hicon, &mut info).is_err() {
            return None;
        }
        let out = (|| {
            let hb = info.hbmColor;
            if hb.is_invalid() {
                return None;
            }
            let mut bm = BITMAP::default();
            if GetObjectW(hb.into(), std::mem::size_of::<BITMAP>() as i32, Some(&mut bm as *mut _ as *mut _)) == 0 {
                return None;
            }
            let (w, h) = (bm.bmWidth, bm.bmHeight.abs());
            if w <= 0 || h <= 0 || w > 256 || h > 256 {
                return None;
            }
            let mut bi = BITMAPINFO {
                bmiHeader: BITMAPINFOHEADER {
                    biSize: std::mem::size_of::<BITMAPINFOHEADER>() as u32,
                    biWidth: w,
                    biHeight: -h, // top-down
                    biPlanes: 1,
                    biBitCount: 32,
                    ..Default::default()
                },
                ..Default::default()
            };
            let mut px = vec![0u8; (w * h * 4) as usize];
            let dc = GetDC(None);
            let got = GetDIBits(dc, hb, 0, h as u32, Some(px.as_mut_ptr().cast()), &mut bi, DIB_RGB_COLORS);
            ReleaseDC(None, dc);
            if got == 0 {
                return None;
            }
            // BGRA → RGBA in place.
            for p in px.chunks_exact_mut(4) {
                p.swap(0, 2);
            }
            Some((px, w, h))
        })();
        if !info.hbmColor.is_invalid() {
            let _ = DeleteObject(info.hbmColor.into());
        }
        if !info.hbmMask.is_invalid() {
            let _ = DeleteObject(info.hbmMask.into());
        }
        out
    }

    /// Icons already read, by hwnd: the page polls every two seconds, and
    /// re-extracting every window's pixels each time is work nobody sees.
    /// An entry is only reused while the exe is still the same; a dead hwnd's
    /// place is taken again when the handle is recycled.
    fn icon_cached(hwnd: HWND, exe: &str) -> Option<String> {
        use std::collections::HashMap;
        use std::sync::Mutex;
        static CACHE: Mutex<Option<HashMap<isize, (String, Option<String>)>>> = Mutex::new(None);
        let mut slot = CACHE.lock().unwrap_or_else(std::sync::PoisonError::into_inner);
        let map = slot.get_or_insert_with(HashMap::new);
        if map.len() > 128 {
            map.clear();
        }
        if let Some((cached_exe, icon)) = map.get(&(hwnd.0 as isize)) {
            if cached_exe == exe {
                return icon.clone();
            }
        }
        let icon = unsafe { icon_of(hwnd, exe) };
        map.insert(hwnd.0 as isize, (exe.to_string(), icon.clone()));
        icon
    }

    /// The windows the dock shows: visible, un-cloaked, not tools, not the
    /// shell's, not ours. One entry per window, in z-order.
    pub fn list_windows() -> Vec<DockWindow> {
        let mut out: Vec<DockWindow> = Vec::new();
        unsafe {
            let _ = EnumWindows(Some(enumerate), LPARAM(&mut out as *mut Vec<DockWindow> as isize));
        }
        out
    }

    unsafe extern "system" fn enumerate(hwnd: HWND, lparam: LPARAM) -> windows::core::BOOL {
        let out: &mut Vec<DockWindow> = &mut *(lparam.0 as *mut Vec<DockWindow>);
        if !IsWindowVisible(hwnd).as_bool() {
            return true.into();
        }
        // Cloaked windows (UWP's paused apps) are not really on screen.
        let mut cloaked: u32 = 0;
        if DwmGetWindowAttribute(hwnd, DWMWA_CLOAKED, &mut cloaked as *mut _ as *mut _, 4).is_ok() && cloaked != 0 {
            return true.into();
        }
        if (GetWindowLongPtrW(hwnd, GWL_EXSTYLE) as u32 & WS_EX_TOOLWINDOW.0) != 0 {
            return true.into();
        }
        let title = title_of(hwnd);
        if title.is_empty() {
            return true.into();
        }
        let mut pid = 0u32;
        GetWindowThreadProcessId(hwnd, Some(&mut pid));
        if pid == 0 || pid == std::process::id() {
            return true.into();
        }
        let exe = exe_of(pid);
        let icon = icon_cached(hwnd, &exe);
        out.push(DockWindow {
            hwnd: hwnd.0 as u64,
            title,
            exe,
            icon,
            minimized: IsIconic(hwnd).as_bool(),
        });
        true.into()
    }

    /// Restores and brings the window up. The ALT tap tells Windows this is a
    /// user gesture, so SetForegroundWindow is allowed (the foreground lock).
    pub fn focus_hwnd(hwnd: u64) -> bool {
        unsafe {
            let h = HWND(hwnd as *mut _);
            if !IsWindow(Some(h)).as_bool() {
                return false;
            }
            if IsIconic(h).as_bool() {
                let _ = ShowWindow(h, SW_RESTORE);
            }
            keybd_event(VK_MENU.0 as u8, 0, KEYBD_EVENT_FLAGS(0), 0);
            let ok = SetForegroundWindow(h).as_bool();
            keybd_event(VK_MENU.0 as u8, 0, KEYEVENTF_KEYUP, 0);
            if !ok {
                // Refused: flash its taskbar button instead, the polite no.
                let mut flash = FLASHWINFO {
                    cbSize: std::mem::size_of::<FLASHWINFO>() as u32,
                    hwnd: h,
                    dwFlags: FLASHW_TRAY,
                    uCount: 3,
                    dwTimeout: 0,
                };
                let _ = FlashWindowEx(&mut flash);
            }
            ok
        }
    }

    pub fn minimize_hwnd(hwnd: u64) {
        unsafe {
            let h = HWND(hwnd as *mut _);
            if IsWindow(Some(h)).as_bool() {
                let _ = ShowWindow(h, SW_MINIMIZE);
            }
        }
    }
}

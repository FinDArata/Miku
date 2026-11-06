// Miku runs without a console window: the mascot is the whole UI.
//
// Not only in a release build. A debug build that opened a console left one
// window behind on every start — and it stayed after Miku was closed, because
// nothing owned it. A debug run that wants to see the log can ask for that
// console back with MIKU_CONSOLE=1 (AttachConsole keeps it for panics and
// println!, which a plain windows_subsystem build would have nowhere to write).
#![windows_subsystem = "windows"]

#[cfg(all(windows, debug_assertions))]
mod console {
    #[link(name = "kernel32")]
    extern "system" {
        fn AttachConsole(process_id: u32) -> i32;
        fn GetConsoleWindow() -> isize;
        fn SetConsoleOutputCP(code_page: u32) -> i32;
    }
    const ATTACH_PARENT_PROCESS: u32 = 0xFFFF_FFFF;

    /// Attaches to the terminal that started us, when MIKU_CONSOLE=1.
    pub fn keep_parent_console() {
        if std::env::var_os("MIKU_CONSOLE").is_none() {
            return;
        }
        // SAFETY: plain win32 calls with no pointers involved; the attached
        // console lasts as long as this process does.
        unsafe {
            if AttachConsole(ATTACH_PARENT_PROCESS) != 0 && GetConsoleWindow() != 0 {
                SetConsoleOutputCP(65001); // UTF-8, so the log reads as written
            }
        }
    }
}

fn main() {
    #[cfg(all(windows, debug_assertions))]
    console::keep_parent_console();
    miku_lib::run()
}

fn main() {
    // Every exe the crate builds — miku.exe, and the `cargo test` harnesses —
    // imports TaskDialogIndirect, a comctl32 v6 function. Without a manifest
    // Windows binds those binaries to comctl32 v5, which has no such entry
    // point, and they die with STATUS_ENTRYPOINT_NOT_FOUND before main (the
    // test harnesses on the machine and on CI alike). One manifest for all of
    // them: tauri-build's default one, embedded by the linker instead of by
    // tauri-build's resource, so no target ends up with two.
    #[cfg(target_os = "windows")]
    {
        let manifest = std::path::Path::new(&std::env::var("CARGO_MANIFEST_DIR").unwrap())
            .join("test.manifest");
        println!("cargo:rustc-link-arg=/MANIFEST:EMBED");
        println!("cargo:rustc-link-arg=/MANIFESTINPUT:{}", manifest.display());
        let attributes = tauri_build::Attributes::new().windows_attributes(
            tauri_build::WindowsAttributes::new_without_app_manifest(),
        );
        tauri_build::try_build(attributes)
            .expect("tauri-build failed");
    }
    #[cfg(not(target_os = "windows"))]
    tauri_build::build()
}

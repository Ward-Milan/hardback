fn main() {
    let now_secs = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();
    println!("cargo:rustc-env=HARDBACK_BUILD_TIME_SECS={}", now_secs);
    tauri_build::build();
}

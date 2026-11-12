#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
#[cfg(windows)]
fn main() {
    terino_prototype::windows::run();
}
#[cfg(not(windows))]
fn main() {
    eprintln!("Este protótipo é exclusivo para Windows. Use cargo test para verificar o domínio.");
}

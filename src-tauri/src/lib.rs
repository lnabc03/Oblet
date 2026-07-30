mod commands;
mod state;
mod theme;

use state::{window_label_for, AppState};
use std::path::PathBuf;
use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindowBuilder};

/// 打开文件对应窗口；已打开则聚焦
fn open_or_focus(app: &AppHandle, path: &str) {
    let label = window_label_for(path);
    if let Some(win) = app.get_webview_window(&label) {
        let _ = win.unminimize();
        let _ = win.set_focus();
        return;
    }

    let title = std::path::Path::new(path)
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("Oblet")
        .to_string();

    match WebviewWindowBuilder::new(app, &label, WebviewUrl::App("index.html".into()))
        .title(format!("{title} - Oblet"))
        .inner_size(960.0, 720.0)
        .build()
    {
        Ok(_win) => {
            app.state::<AppState>().register(&label, path);
        }
        Err(e) => eprintln!("创建窗口失败: {e}"),
    }
}

/// 从命令行参数中提取第一个 .md 文件路径（相对路径基于 cwd 解析）
fn md_arg_from(argv: &[String], cwd: &str) -> Option<String> {
    argv.iter().skip(1).find_map(|arg| {
        if !arg.to_lowercase().ends_with(".md") {
            return None;
        }
        let p = PathBuf::from(arg);
        let abs = if p.is_absolute() {
            p
        } else {
            PathBuf::from(cwd).join(p)
        };
        Some(abs.to_string_lossy().to_string())
    })
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, argv, cwd| {
            // 第二实例启动：唤醒已有窗口或新开窗口
            if let Some(path) = md_arg_from(&argv, &cwd) {
                open_or_focus(app, &path);
            } else if let Some(win) = app.get_webview_window("main") {
                let _ = win.set_focus();
            }
        }))
        .manage(AppState::default())
        .invoke_handler(tauri::generate_handler![
            commands::get_window_file,
            commands::read_file,
            commands::write_file,
            theme::get_settings,
            theme::save_settings,
            theme::list_themes,
            theme::import_theme,
            theme::read_theme,
        ])
        .setup(|app| {
            let argv: Vec<String> = std::env::args().collect();
            let cwd = std::env::current_dir()
                .map(|p| p.to_string_lossy().to_string())
                .unwrap_or_default();

            if let Some(path) = md_arg_from(&argv, &cwd) {
                open_or_focus(app.handle(), &path);
            } else {
                // 无参数启动：开一个空窗口
                WebviewWindowBuilder::new(
                    app.handle(),
                    "main",
                    WebviewUrl::App("index.html".into()),
                )
                .title("Oblet")
                .inner_size(960.0, 720.0)
                .build()?;
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

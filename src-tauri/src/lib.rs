mod commands;
mod settings;
mod state;

use notify::EventKind;
use state::{fnv1a, window_label_for, AppState};
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Emitter, Manager, WebviewUrl, WebviewWindowBuilder};

/// 打开文件对应窗口；已打开则聚焦
fn open_or_focus(app: &AppHandle, path: &str) {
    let label = window_label_for(path);
    if let Some(win) = app.get_webview_window(&label) {
        let _ = win.unminimize();
        let _ = win.set_focus();
        return;
    }

    // 拖入换过文件的窗口 label 与路径哈希不再对应，按登记路径再查一次
    if let Some(existing) = app.state::<AppState>().label_for_path(path) {
        if let Some(win) = app.get_webview_window(&existing) {
            let _ = win.unminimize();
            let _ = win.set_focus();
            return;
        }
    }

    let title = std::path::Path::new(path)
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("Oblet")
        .to_string();

    match WebviewWindowBuilder::new(app, &label, WebviewUrl::App("index.html".into()))
        .title(format!("Oblet - {title}"))
        .inner_size(960.0, 720.0)
        // 透明窗口：毛玻璃（Mica/Acrylic）的前提；CSS 背景不透明时与之前视觉一致
        .transparent(true)
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
            commands::set_window_file,
            commands::read_file,
            commands::write_file,
            commands::watch_file,
            commands::set_window_effect,
            settings::get_settings,
            settings::save_settings,
        ])
        .setup(|app| {
            // 文件监听器：外部变更（如 Obsidian 保存）→ 通知对应窗口重载
            let handle = app.handle().clone();
            match notify::recommended_watcher(
                move |res: Result<notify::Event, notify::Error>| {
                    let Ok(event) = res else { return };
                    if !matches!(
                        event.kind,
                        EventKind::Modify(_) | EventKind::Create(_) | EventKind::Remove(_)
                    ) {
                        return;
                    }
                    // 编辑器保存常伴随一串事件，稍作去抖再读盘
                    std::thread::sleep(std::time::Duration::from_millis(100));

                    let norm = |p: &Path| {
                        p.to_string_lossy()
                            .trim_start_matches(r"\\?\")
                            .replace('/', "\\")
                            .to_lowercase()
                    };
                    let state = handle.state::<AppState>();
                    let watched: Vec<(String, PathBuf)> = state
                        .watched
                        .lock()
                        .unwrap()
                        .iter()
                        .map(|(k, v)| (k.clone(), v.clone()))
                        .collect();

                    for (label, file) in watched {
                        if !event.paths.iter().any(|p| norm(p) == norm(&file)) {
                            continue;
                        }
                        if let Ok(bytes) = std::fs::read(&file) {
                            // 文件仍在：哈希一致 = 自身写入或重复事件，跳过。
                            // 注意：Windows 下"临时文件 + rename 覆盖保存"会对目标
                            // 路径发 Remove 事件，不能见 Remove 就通知，否则每次
                            // 自动保存都会误触发一次重载（空行被折叠、光标跳顶）。
                            if state.is_stale_hash(&file.to_string_lossy(), fnv1a(&bytes)) {
                                continue;
                            }
                        }
                        // 读不到 = 真被外部删除/移动，放行通知（前端读失败会给提示）
                        if let Some(win) = handle.get_webview_window(&label) {
                            let _ = win.emit(&format!("file-changed:{label}"), ());
                        }
                    }
                },
            ) {
                Ok(w) => {
                    *app.state::<AppState>().watcher.lock().unwrap() = Some(w);
                }
                Err(e) => eprintln!("创建文件监听器失败: {e}"),
            }

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
                .transparent(true)
                .build()?;
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

mod commands;
mod settings;
mod state;

use notify::EventKind;
use state::{fnv1a, window_label_for, AppState};
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Emitter, Manager, WebviewUrl, WebviewWindowBuilder};

/// 从 exe 同级 data/settings.json 读取 allow_multi_window 设置
fn read_allow_multi_window() -> bool {
    let exe = std::env::current_exe().ok();
    let path = exe.and_then(|p| {
        Some(p.parent()?.join("data").join("settings.json"))
    });
    let path = match path {
        Some(p) if p.exists() => p,
        _ => return false, // 首次运行无设置文件，默认单窗口
    };
    let text = match std::fs::read_to_string(&path) {
        Ok(t) => t,
        Err(_) => return false,
    };
    // 简单解析：找 "allow_multi_window":true（不做完整 JSON 解析，避免引入 serde 依赖到主模块）
    text.contains("\"allow_multi_window\": true")
        || text.contains("\"allow_multi_window\":true")
}

/// 打开文件对应窗口；已打开则聚焦。
/// 批次 7.3：allow_multi_window=false（默认）时追加到前台窗口的 tab 列表
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

    // 多窗口=关（默认）→ 加到前台窗口的 tab 列表中
    if !read_allow_multi_window() {
        // 找前台窗口：优先聚焦窗口，其次第一个有登记的窗口
        let target = app
            .webview_windows()
            .into_iter()
            .find(|(_, w)| w.is_focused().unwrap_or(false))
            .or_else(|| {
                app.webview_windows()
                    .into_iter()
                    .find(|(_, w)| w.is_visible().unwrap_or(false))
            });
        if let Some((_label, win)) = target {
            let _ = win.unminimize();
            let _ = win.set_focus();
            // emit 全局事件通知前端追加 tab
            let payload = serde_json::json!({ "path": path });
            let _ = app.emit("add-tab", payload);
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
    let builder = tauri::Builder::default();
    // 单实例仅 release 注册：锁按 AppID 不分 debug/release，常驻的 dev 实例持锁时，
    // zip 版 release 启动会被劫持转发到陈旧 dev 窗口——用户看到的永远是旧前端快照
    //（七轮"修复未生效"悬案的根因）。dev 不持锁，release 启动即正常自建窗口
    #[cfg(not(debug_assertions))]
    let builder = builder.plugin(tauri_plugin_single_instance::init(|app, argv, cwd| {
        // 第二实例启动：唤醒已有窗口或新开窗口
        if let Some(path) = md_arg_from(&argv, &cwd) {
            open_or_focus(app, &path);
        } else if let Some(win) = app.get_webview_window("main") {
            let _ = win.set_focus();
        }
    }));
    builder
        .manage(AppState::default())
        .invoke_handler(tauri::generate_handler![
            commands::get_window_file,
            commands::set_window_file,
            commands::read_file,
            commands::write_file,
            commands::watch_file,
            commands::set_window_effect,
            commands::save_image_asset,
            commands::export_to_vault,
            commands::create_note,
            commands::get_desktop_dir,
            commands::clear_window_file,
            commands::open_url,
            commands::add_tab,
            commands::remove_tab,
            commands::switch_tab,
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
                    let watched: Vec<(String, Vec<PathBuf>)> = state
                        .watched
                        .lock()
                        .unwrap()
                        .iter()
                        .map(|(k, dirs)| (k.clone(), dirs.iter().cloned().collect()))
                        .collect();

                    for (label, dirs) in watched {
                        // 事件路径是否命中该窗口监听的任一目录
                        if !event.paths.iter().any(|ep| {
                            dirs.iter().any(|d| {
                                ep.starts_with(d)
                            })
                        }) {
                            continue;
                        }
                        // 检查事件中涉及的 .md 文件是否在该窗口的 tab 列表中
                        let windows = state.windows.lock().unwrap();
                        let tab_paths: Vec<String> = windows
                            .get(&label)
                            .map(|(tabs, _)| tabs.clone())
                            .unwrap_or_default();
                        drop(windows);
                        // 找到受影响的 tab 文件（事件路径与该 tab 路径匹配）
                        let affected: Vec<&String> = tab_paths
                            .iter()
                            .filter(|tp| {
                                let norm_tp = norm(&PathBuf::from(tp));
                                event.paths.iter().any(|ep| norm(ep) == norm_tp)
                            })
                            .collect();
                        if affected.is_empty() {
                            continue;
                        }
                        // 检查哈希过滤：所有受影响的文件哈希都与记录一致则跳过
                        let all_stale = affected.iter().all(|tp| {
                            if let Ok(bytes) = std::fs::read(tp) {
                                state.is_stale_hash(tp, fnv1a(&bytes))
                            } else {
                                false // 读不到 = 真被删，放行
                            }
                        });
                        if all_stale {
                            continue;
                        }
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

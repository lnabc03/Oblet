use serde::Serialize;
use std::fs;
use std::path::{Path, PathBuf};

use crate::state::{fnv1a, AppState};
use notify::{RecursiveMode, Watcher};
use tauri::State;

#[derive(Serialize)]
pub struct FilePayload {
    /// 文件内容（非 UTF-8 时为 lossy 转换结果）
    pub content: String,
    /// 原文件换行符："LF" | "CRLF"
    pub newline: String,
    /// 是否只读（非 UTF-8 编码时 v1 只读）
    pub readonly: bool,
    /// 只读原因（展示给用户）
    pub readonly_reason: Option<String>,
}

/// 当前窗口打开的文件路径（窗口启动时由 Rust 侧登记）
#[tauri::command]
pub fn get_window_file(state: State<AppState>, window: tauri::Window) -> Option<String> {
    state.path_for(window.label())
}

/// 拖入 .md 换文件：更新窗口登记路径并同步标题（label 不可变，仍用旧 label）
#[tauri::command]
pub fn set_window_file(
    state: State<AppState>,
    window: tauri::Window,
    path: String,
) -> Result<(), String> {
    state.register(window.label(), &path);
    let title = Path::new(&path)
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("Oblet");
    window
        .set_title(&format!("Oblet - {title}"))
        .map_err(|e| format!("设置标题失败: {e}"))?;
    Ok(())
}

#[tauri::command]
pub fn read_file(state: State<AppState>, path: String) -> Result<FilePayload, String> {
    let bytes = fs::read(&path).map_err(|e| format!("读取文件失败: {e}"))?;
    state.note_hash(&path, fnv1a(&bytes));

    // 剥离 UTF-8 BOM
    let bytes = if bytes.starts_with(&[0xEF, 0xBB, 0xBF]) {
        &bytes[3..]
    } else {
        &bytes[..]
    };

    // 换行符探测：以第一个出现的换行为准
    let newline = detect_newline(bytes);

    match String::from_utf8(bytes.to_vec()) {
        Ok(content) => Ok(FilePayload {
            content,
            newline,
            readonly: false,
            readonly_reason: None,
        }),
        Err(_) => Ok(FilePayload {
            content: String::from_utf8_lossy(bytes).into_owned(),
            newline,
            readonly: true,
            readonly_reason: Some(
                "该文件不是 UTF-8 编码（可能是 GBK），v1 暂不支持编辑，已只读打开".to_string(),
            ),
        }),
    }
}

fn detect_newline(bytes: &[u8]) -> String {
    for (i, &b) in bytes.iter().enumerate() {
        if b == b'\n' {
            if i > 0 && bytes[i - 1] == b'\r' {
                return "CRLF".to_string();
            }
            return "LF".to_string();
        }
    }
    // 无换行的新文件：Windows 平台默认 CRLF
    "CRLF".to_string()
}

/// 原子写入：临时文件 + rename；换行符跟随原文件
#[tauri::command]
pub fn write_file(
    state: State<AppState>,
    path: String,
    content: String,
    newline: String,
) -> Result<(), String> {
    let p = Path::new(&path);
    let dir = p.parent().ok_or("非法路径")?;
    let tmp = dir.join(format!(
        ".oblet-tmp-{}",
        p.file_name().and_then(|n| n.to_str()).unwrap_or("untitled")
    ));

    // 先归一化为 LF，再按目标换行符转换
    let normalized = content.replace("\r\n", "\n");
    let output = if newline == "CRLF" {
        normalized.replace('\n', "\r\n")
    } else {
        normalized
    };

    fs::write(&tmp, output.as_bytes()).map_err(|e| format!("写入临时文件失败: {e}"))?;
    fs::rename(&tmp, p).map_err(|e| {
        let _ = fs::remove_file(&tmp);
        format!("落盘失败: {e}")
    })?;
    // 记录落盘内容哈希：文件监听器据此过滤自身写入事件
    state.note_hash(&path, fnv1a(output.as_bytes()));
    Ok(())
}

/// 监听窗口当前文件的外部变更（监听父目录，按文件名过滤，
/// 以兼容 Obsidian 等编辑器 rename 式原子保存）
#[tauri::command]
pub fn watch_file(state: State<AppState>, window: tauri::Window, path: String) -> Result<(), String> {
    let label = window.label().to_string();
    let file = PathBuf::from(&path);
    let dir = file
        .parent()
        .ok_or("非法路径")?
        .to_path_buf();

    // 换绑：旧文件所在目录若无其他窗口监听则解除
    let old = state.watched.lock().unwrap().insert(label, file.clone());
    if let Some(old_file) = old {
        if old_file != file {
            let old_dir = old_file.parent().map(|p| p.to_path_buf());
            let still_needed = state
                .watched
                .lock()
                .unwrap()
                .values()
                .any(|f| f.parent().map(|p| p.to_path_buf()) == old_dir);
            if !still_needed {
                if let (Some(w), Some(d)) = (state.watcher.lock().unwrap().as_mut(), old_dir) {
                    let _ = w.unwatch(&d);
                }
            }
        }
    }

    let mut guard = state.watcher.lock().unwrap();
    if let Some(w) = guard.as_mut() {
        w.watch(&dir, RecursiveMode::NonRecursive)
            .map_err(|e| format!("监听失败: {e}"))?;
    }
    Ok(())
}

// 窗口材质效果（毛玻璃）：window-vibrancy 官方方案。
// 窗口建为 transparent，效果开启时前端 CSS 让出背景（body.ob-vibrancy 透明链路）
// Acrylic 已按十一轮终审删除（方案留档见打磨清单 4.1，浅色主题适配时或可参考复用）
#[tauri::command]
pub fn set_window_effect(window: tauri::WebviewWindow, effect: Option<String>) -> Result<(), String> {
    let res = match effect.as_deref() {
        Some("mica") => window_vibrancy::apply_mica(&window, Some(true)),
        _ => {
            // 关：两种都清（mica 互不知晓 acrylic 是否应用过——旧版本可能残留；未应用时 clear 亦安全返回）
            let a = window_vibrancy::clear_mica(&window);
            let b = window_vibrancy::clear_acrylic(&window);
            a.and(b)
        }
    };
    res.map_err(|e| e.to_string())
}

// 保存至 Obsidian Vault（批次 7.1）：把当前 md 原文复制到用户配置的目标文件夹。
// 路径规整在前端做（引号/正反斜杠/UNC 全容忍），这里只做安全校验 + 原子写入。
// overwrite=false 且目标已存在时返回约定错误码，由前端弹确认后带 overwrite=true 重试。
#[tauri::command]
pub fn export_to_vault(
    target_dir: String,
    file_name: String,
    content: String,
    overwrite: bool,
) -> Result<String, String> {
    // 防逃逸：file_name 必须是纯文件名（路径分隔符/盘符一律拒绝）
    if file_name.is_empty()
        || file_name.contains('/')
        || file_name.contains('\\')
        || file_name.contains(':')
    {
        return Err("非法文件名".to_string());
    }
    let dir = PathBuf::from(&target_dir);
    if !dir.is_dir() {
        return Err(format!("目录不存在: {target_dir}"));
    }
    let dest = dir.join(&file_name);
    if dest.exists() && !overwrite {
        return Err("EXISTS".to_string());
    }
    // 原子写入（与 write_file 同款临时文件 + rename；rename 在 Windows 上覆盖已存在目标是合法的）
    let tmp = dir.join(format!(".oblet-tmp-{file_name}"));
    fs::write(&tmp, content.as_bytes()).map_err(|e| {
        let _ = fs::remove_file(&tmp);
        format!("写入临时文件失败: {e}")
    })?;
    fs::rename(&tmp, &dest).map_err(|e| {
        let _ = fs::remove_file(&tmp);
        format!("落盘失败: {e}")
    })?;
    Ok(dest.to_string_lossy().into_owned())
}

// 外链用系统默认浏览器打开：Tauri webview 对 target=_blank 不做任何处理，
// 悬浮窗里的网址点击会无响应（七轮反馈）。rundll32 方案零新增依赖。
#[tauri::command]
pub fn open_url(url: String) -> Result<(), String> {
    if !url.starts_with("http://") && !url.starts_with("https://") {
        return Err("仅支持打开 http/https 链接".to_string());
    }
    std::process::Command::new("rundll32")
        .args(["url.dll,FileProtocolHandler", &url])
        .spawn()
        .map_err(|e| format!("打开链接失败: {e}"))?;
    Ok(())
}

// 粘贴/拖入图片落盘（3.7 收口）：Crepe 默认 onUpload 是 blob: 内存 URL，
// 保存进 md 重开即失效——复制到 md 同目录 assets/ 并返回相对引用（对齐 Obsidian 附件行为）
#[tauri::command]
pub fn save_image_asset(
    state: State<AppState>,
    window: tauri::Window,
    name: String,
    data: Vec<u8>,
) -> Result<String, String> {
    let path = state
        .path_for(window.label())
        .ok_or("窗口未登记文件")?;
    let dir = Path::new(&path)
        .parent()
        .ok_or("非法路径")?
        .join("assets");
    fs::create_dir_all(&dir).map_err(|e| format!("创建 assets 目录失败: {e}"))?;

    // Windows 非法字符净化；空名回退 image.png
    let clean: String = name
        .chars()
        .map(|c| match c {
            '<' | '>' | ':' | '"' | '/' | '\\' | '|' | '?' | '*' => '_',
            c if c.is_control() => '_',
            c => c,
        })
        .collect();
    let clean = if clean.trim().is_empty() {
        "image.png".to_string()
    } else {
        clean
    };
    let p = PathBuf::from(&clean);
    let stem = p
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("image")
        .to_string();
    let ext = p.extension().and_then(|s| s.to_str()).unwrap_or("png");

    // 冲突去重：foo.png → foo-1.png → foo-2.png
    let mut file_name = format!("{stem}.{ext}");
    let mut i = 1;
    while dir.join(&file_name).exists() {
        file_name = format!("{stem}-{i}.{ext}");
        i += 1;
    }
    fs::write(dir.join(&file_name), &data).map_err(|e| format!("写入图片失败: {e}"))?;
    Ok(format!("assets/{file_name}"))
}

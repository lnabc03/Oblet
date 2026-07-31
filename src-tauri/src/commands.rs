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

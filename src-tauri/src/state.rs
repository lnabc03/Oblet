use std::collections::HashMap;
use std::sync::Mutex;

/// 窗口 label → 打开的文件绝对路径
#[derive(Default)]
pub struct AppState {
    pub windows: Mutex<HashMap<String, String>>,
}

impl AppState {
    pub fn register(&self, label: &str, path: &str) {
        self.windows
            .lock()
            .unwrap()
            .insert(label.to_string(), path.to_string());
    }

    pub fn path_for(&self, label: &str) -> Option<String> {
        self.windows.lock().unwrap().get(label).cloned()
    }
}

/// 由文件路径生成稳定的窗口 label（FNV-1a 哈希，避免路径中的非法字符）
pub fn window_label_for(path: &str) -> String {
    let canonical = std::fs::canonicalize(path)
        .map(|p| p.to_string_lossy().to_lowercase())
        .unwrap_or_else(|_| path.to_lowercase());
    let mut hash: u64 = 0xcbf29ce484222325;
    for b in canonical.bytes() {
        hash ^= b as u64;
        hash = hash.wrapping_mul(0x100000001b3);
    }
    format!("file-{hash:016x}")
}

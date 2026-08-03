use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Mutex;

use notify::RecommendedWatcher;

/// 全局应用状态
#[derive(Default)]
pub struct AppState {
    /// 窗口 label → 打开的文件绝对路径
    pub windows: Mutex<HashMap<String, String>>,
    /// 文件监听器（notify 句柄，随 AppState 存活）
    pub watcher: Mutex<Option<RecommendedWatcher>>,
    /// 窗口 label → 正在监听的文件
    pub watched: Mutex<HashMap<String, PathBuf>>,
    /// 归一化路径 → 最近一次读到/写入的内容哈希（自写事件过滤 + 重复事件去重）
    pub last_hash: Mutex<HashMap<String, u64>>,
}

impl AppState {
    pub fn register(&self, label: &str, path: &str) {
        self.windows
            .lock()
            .unwrap()
            .insert(label.to_string(), path.to_string());
    }

    pub fn unregister(&self, label: &str) {
        self.windows.lock().unwrap().remove(label);
    }

    pub fn path_for(&self, label: &str) -> Option<String> {
        self.windows.lock().unwrap().get(label).cloned()
    }

    /// 按登记路径反查窗口 label（拖入换过文件的窗口 label 与路径哈希不再对应）
    pub fn label_for_path(&self, path: &str) -> Option<String> {
        let target = canonical_key(path);
        self.windows
            .lock()
            .unwrap()
            .iter()
            .find_map(|(label, p)| (canonical_key(p) == target).then(|| label.clone()))
    }

    /// 记录路径的内容哈希（读/写文件后调用）
    pub fn note_hash(&self, path: &str, hash: u64) {
        self.last_hash
            .lock()
            .unwrap()
            .insert(canonical_key(path), hash);
    }

    /// 事件去重判定：哈希与上次一致 = 重复事件或自身写入，返回 true 表示应忽略
    pub fn is_stale_hash(&self, path: &str, hash: u64) -> bool {
        let mut map = self.last_hash.lock().unwrap();
        let key = canonical_key(path);
        if map.get(&key) == Some(&hash) {
            return true;
        }
        map.insert(key, hash);
        false
    }
}

/// 路径归一化键：规范化 + 小写（Windows 不区分大小写）
fn canonical_key(path: &str) -> String {
    std::fs::canonicalize(path)
        .map(|p| p.to_string_lossy().to_lowercase())
        .unwrap_or_else(|_| path.to_lowercase())
}

/// FNV-1a 内容哈希（用于自写事件过滤，非密码学用途）
pub fn fnv1a(bytes: &[u8]) -> u64 {
    let mut hash: u64 = 0xcbf29ce484222325;
    for &b in bytes {
        hash ^= b as u64;
        hash = hash.wrapping_mul(0x100000001b3);
    }
    hash
}

/// 由文件路径生成稳定的窗口 label（FNV-1a 哈希，避免路径中的非法字符）
pub fn window_label_for(path: &str) -> String {
    let canonical = canonical_key(path);
    format!("file-{:016x}", fnv1a(canonical.as_bytes()))
}

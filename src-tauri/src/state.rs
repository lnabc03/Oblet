use std::collections::{HashMap, HashSet};
use std::path::PathBuf;
use std::sync::{Mutex, OnceLock};

use notify::RecommendedWatcher;

/// 启动打点（性能专题 baseline）：exe 入口与首窗建成时刻（epoch ms，OnceLock 只记第一次）
pub static PROCESS_START_MS: OnceLock<u64> = OnceLock::new();
pub static FIRST_WINDOW_BUILT_MS: OnceLock<u64> = OnceLock::new();

pub fn epoch_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

/// 全局应用状态
#[derive(Default)]
pub struct AppState {
    /// 窗口 label → (有序 tab 路径列表, 当前活跃索引)
    pub windows: Mutex<HashMap<String, (Vec<String>, usize)>>,
    /// 文件监听器（notify 句柄，随 AppState 存活）
    pub watcher: Mutex<Option<RecommendedWatcher>>,
    /// 窗口 label → 正在监听的目录集合（一个窗口可监听多个目录）
    pub watched: Mutex<HashMap<String, HashSet<PathBuf>>>,
    /// 归一化路径 → 最近一次读到/写入的内容哈希（自写事件过滤 + 重复事件去重）
    pub last_hash: Mutex<HashMap<String, u64>>,
}

impl AppState {
    pub fn register(&self, label: &str, path: &str) {
        self.windows
            .lock()
            .unwrap()
            .insert(label.to_string(), (vec![path.to_string()], 0));
    }

    pub fn unregister(&self, label: &str) {
        self.windows.lock().unwrap().remove(label);
        self.watched.lock().unwrap().remove(label);
    }

    /// 返回活跃 tab 的文件路径（兼容旧调用方）
    pub fn path_for(&self, label: &str) -> Option<String> {
        self.windows
            .lock()
            .unwrap()
            .get(label)
            .map(|(tabs, idx)| tabs.get(*idx).cloned())
            .flatten()
    }

    /// 按登记路径反查窗口 label（遍历所有 tab 列表）
    pub fn label_for_path(&self, path: &str) -> Option<String> {
        let target = canonical_key(path);
        self.windows
            .lock()
            .unwrap()
            .iter()
            .find_map(|(label, (tabs, _))| {
                tabs.iter().any(|p| canonical_key(p) == target).then(|| label.clone())
            })
    }

    /// 追加 tab 到窗口的路径列表；若路径已在列表中则返回已有索引，否则追加并返回新索引
    pub fn add_tab(&self, label: &str, path: &str) -> usize {
        let mut map = self.windows.lock().unwrap();
        let entry = map.entry(label.to_string()).or_insert_with(|| (Vec::new(), 0));
        let target = canonical_key(path);
        if let Some(pos) = entry.0.iter().position(|p| canonical_key(p) == target) {
            entry.1 = pos;
            return pos;
        }
        entry.0.push(path.to_string());
        let idx = entry.0.len() - 1;
        entry.1 = idx;
        idx
    }

    /// 移除指定索引的 tab。返回新的 tabs 列表与活跃索引（若窗口无 tab 则删 entry 返回 None）
    pub fn remove_tab(&self, label: &str, index: usize) -> Option<(Vec<String>, usize)> {
        let mut map = self.windows.lock().unwrap();
        let entry = map.get_mut(label)?;
        if entry.0.len() <= 1 {
            map.remove(label);
            return None;
        }
        entry.0.remove(index);
        // 调整活跃索引：若被删的是活跃 tab 或之后，前移一位
        if entry.1 >= index {
            entry.1 = entry.1.saturating_sub(1);
        }
        if entry.1 >= entry.0.len() {
            entry.1 = entry.0.len() - 1;
        }
        Some((entry.0.clone(), entry.1))
    }

    /// 设置窗口的活跃 tab 索引
    pub fn set_active(&self, label: &str, index: usize) {
        if let Some(entry) = self.windows.lock().unwrap().get_mut(label) {
            if index < entry.0.len() {
                entry.1 = index;
            }
        }
    }

    /// 返回窗口的完整 tab 列表 + 活跃索引
    pub fn get_tabs(&self, label: &str) -> Option<(Vec<String>, usize)> {
        self.windows
            .lock()
            .unwrap()
            .get(label)
            .map(|(tabs, idx)| (tabs.clone(), *idx))
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

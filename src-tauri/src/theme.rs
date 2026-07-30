// 主题与设置：./data 目录（exe 同级，绿色版）
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;

#[derive(Serialize, Deserialize, Clone, Default)]
pub struct ThemeSetting {
    pub active: Option<String>,
    pub mode: Option<String>, // "light" | "dark"
    #[serde(default)]
    pub follow_system: bool,
}

#[derive(Serialize, Deserialize, Clone, Default)]
pub struct EditorSetting {
    #[serde(default = "default_true")]
    pub auto_save: bool,
    #[serde(default = "default_delay")]
    pub auto_save_delay_ms: u64,
}

fn default_true() -> bool {
    true
}
fn default_delay() -> u64 {
    1000
}

#[derive(Serialize, Deserialize, Default)]
pub struct Settings {
    pub version: Option<u32>,
    #[serde(default)]
    pub theme: ThemeSetting,
    #[serde(default)]
    pub editor: EditorSetting,
}

#[derive(Serialize)]
pub struct ThemeInfo {
    pub name: String,
    pub author: Option<String>,
}

fn data_dir() -> Result<PathBuf, String> {
    let exe = std::env::current_exe().map_err(|e| e.to_string())?;
    Ok(exe
        .parent()
        .ok_or("无法定位 exe 目录")?
        .join("data"))
}

fn settings_path() -> Result<PathBuf, String> {
    Ok(data_dir()?.join("settings.json"))
}

#[tauri::command]
pub fn get_settings() -> Result<Settings, String> {
    let p = settings_path()?;
    if !p.exists() {
        return Ok(Settings::default());
    }
    let text = fs::read_to_string(&p).map_err(|e| e.to_string())?;
    serde_json::from_str(&text).map_err(|e| format!("settings.json 解析失败: {e}"))
}

#[tauri::command]
pub fn save_settings(settings: Settings) -> Result<(), String> {
    let dir = data_dir()?;
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let p = dir.join("settings.json");
    let tmp = dir.join(".settings.json.tmp");
    let text = serde_json::to_string_pretty(&settings).map_err(|e| e.to_string())?;
    fs::write(&tmp, text).map_err(|e| e.to_string())?;
    fs::rename(&tmp, &p).map_err(|e| e.to_string())?;
    Ok(())
}

/// 列出 ./data/themes 下的主题（manifest.json 提供作者信息）
#[tauri::command]
pub fn list_themes() -> Result<Vec<ThemeInfo>, String> {
    let dir = data_dir()?.join("themes");
    let mut out = Vec::new();
    if !dir.exists() {
        return Ok(out);
    }
    for entry in fs::read_dir(&dir).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let path = entry.path();
        if !path.is_dir() || !path.join("theme.css").exists() {
            continue;
        }
        let name = entry.file_name().to_string_lossy().to_string();
        let author = fs::read_to_string(path.join("manifest.json"))
            .ok()
            .and_then(|t| serde_json::from_str::<serde_json::Value>(&t).ok())
            .and_then(|v| v.get("author").and_then(|a| a.as_str()).map(String::from));
        out.push(ThemeInfo { name, author });
    }
    out.sort_by(|a, b| a.name.cmp(&b.name));
    Ok(out)
}

/// 导入主题：把 theme.css（及可选 manifest.json）复制到 ./data/themes/<name>/
#[tauri::command]
pub fn import_theme(css_path: String) -> Result<String, String> {
    let src = PathBuf::from(&css_path);
    if !src.exists() {
        return Err("theme.css 不存在".to_string());
    }
    // 主题名：同目录 manifest.json 的 name，否则用目录名
    let dir_name = src
        .parent()
        .and_then(|p| p.file_name())
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_else(|| "imported".to_string());
    let name = src
        .parent()
        .map(|p| p.join("manifest.json"))
        .and_then(|m| fs::read_to_string(m).ok())
        .and_then(|t| serde_json::from_str::<serde_json::Value>(&t).ok())
        .and_then(|v| v.get("name").and_then(|n| n.as_str()).map(String::from))
        .unwrap_or(dir_name);

    let dest = data_dir()?.join("themes").join(&name);
    fs::create_dir_all(&dest).map_err(|e| e.to_string())?;
    fs::copy(&src, dest.join("theme.css")).map_err(|e| format!("复制 theme.css 失败: {e}"))?;
    let manifest_src = src.parent().unwrap().join("manifest.json");
    if manifest_src.exists() {
        let _ = fs::copy(&manifest_src, dest.join("manifest.json"));
    }
    Ok(name)
}

/// 读取主题 CSS 原文（sanitize 在前端做）
#[tauri::command]
pub fn read_theme(name: String) -> Result<String, String> {
    let p = data_dir()?.join("themes").join(&name).join("theme.css");
    fs::read_to_string(&p).map_err(|e| format!("读取主题失败: {e}"))
}

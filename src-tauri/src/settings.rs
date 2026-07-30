// 设置持久化：./data/settings.json（exe 同级，绿色版）
// （主题已固化为 AnuPpuccin 深色单主题，只剩排版覆盖）
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;

#[derive(Serialize, Deserialize, Clone, Default)]
pub struct EditorSetting {
    #[serde(default = "default_true")]
    pub auto_save: bool,
    #[serde(default = "default_delay")]
    pub auto_save_delay_ms: u64,
    // 排版覆盖（对齐 Obsidian appearance.json）：None 表示跟随主题
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub text_font: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub mono_font: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub interface_font: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub base_font_size: Option<u32>,
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
    pub editor: EditorSetting,
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
    // 旧版 settings.json 里已删除的 theme 字段由 serde 自动忽略
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

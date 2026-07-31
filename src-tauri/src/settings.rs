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
    // 排版覆盖（对齐 Obsidian appearance.json）：None 表示跟随主题。
    // 全部显式序列化（None → null）：让 settings.json 自说明，空文件也写完整默认形
    #[serde(default)]
    pub text_font: Option<String>,
    #[serde(default)]
    pub mono_font: Option<String>,
    #[serde(default)]
    pub interface_font: Option<String>,
    #[serde(default)]
    pub base_font_size: Option<u32>,
    // 代码块软换行：None/false = 不换行（CM 默认横向滚动）
    #[serde(default)]
    pub code_block_wrap: Option<bool>,
    // 起始页署名：None/true = 显示
    #[serde(default)]
    pub show_author: Option<bool>,
}

fn default_true() -> bool {
    true
}
fn default_delay() -> u64 {
    1000
}

#[derive(Serialize, Deserialize, Clone, Default)]
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
        // 默认值实体化：首次运行即落盘完整默认形，用户可直接看到/手改全部字段
        let s = Settings {
            version: Some(1),
            ..Default::default()
        };
        save_settings(s.clone())?;
        return Ok(s);
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

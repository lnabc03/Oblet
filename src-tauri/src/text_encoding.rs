use chardetng::EncodingDetector;
use encoding_rs::{GBK, UTF_16BE, UTF_16LE};

const UTF8_BOM: &[u8] = &[0xEF, 0xBB, 0xBF];
const UTF16LE_BOM: &[u8] = &[0xFF, 0xFE];
const UTF16BE_BOM: &[u8] = &[0xFE, 0xFF];

/// 文件原始字节的解码结果。只有有效 UTF-8 可编辑，其余编码一律只读。
pub struct DecodedText {
    pub content: String,
    pub encoding: String,
    pub bom: bool,
    pub readonly: bool,
    pub readonly_reason: Option<String>,
}

impl DecodedText {
    fn utf8(content: String, bom: bool) -> Self {
        Self {
            content,
            encoding: "utf8".to_string(),
            bom,
            readonly: false,
            readonly_reason: None,
        }
    }

    fn readonly(content: String, encoding: &str, bom: bool, readonly_reason: String) -> Self {
        Self {
            content,
            encoding: encoding.to_string(),
            bom,
            readonly: true,
            readonly_reason: Some(readonly_reason),
        }
    }
}

/// BOM 优先于启发式探测；无 BOM 时先严格验证 UTF-8，再识别 GBK/GB18030。
pub fn decode(bytes: &[u8]) -> DecodedText {
    if let Some(body) = bytes.strip_prefix(UTF8_BOM) {
        return match String::from_utf8(body.to_vec()) {
            Ok(content) => DecodedText::utf8(content, true),
            Err(_) => DecodedText::readonly(
                String::from_utf8_lossy(body).into_owned(),
                "unknown",
                true,
                "文件带 UTF-8 BOM，但内容不是有效 UTF-8；容错显示的内容可能不完整或有乱码，已只读打开，禁止写回"
                    .to_string(),
            ),
        };
    }

    if let Some(body) = bytes.strip_prefix(UTF16LE_BOM) {
        return decode_utf16(body, UTF_16LE, "utf16le", "UTF-16 LE");
    }
    if let Some(body) = bytes.strip_prefix(UTF16BE_BOM) {
        return decode_utf16(body, UTF_16BE, "utf16be", "UTF-16 BE");
    }

    match String::from_utf8(bytes.to_vec()) {
        Ok(content) => DecodedText::utf8(content, false),
        Err(_) => decode_non_utf8(bytes),
    }
}

fn decode_utf16(
    body: &[u8],
    encoding: &'static encoding_rs::Encoding,
    encoding_name: &str,
    display_name: &str,
) -> DecodedText {
    if let Some(content) = encoding.decode_without_bom_handling_and_without_replacement(body) {
        return DecodedText::readonly(
            content.into_owned(),
            encoding_name,
            true,
            format!("检测到 {display_name} BOM，当前版本不支持编辑，已只读打开，不会写回"),
        );
    }

    let (content, _) = encoding.decode_without_bom_handling(body);
    DecodedText::readonly(
        content.into_owned(),
        encoding_name,
        true,
        format!("{display_name} 数据包含无效序列，容错显示的内容可能不完整；已只读打开，禁止写回"),
    )
}

fn decode_non_utf8(bytes: &[u8]) -> DecodedText {
    let mut detector = EncodingDetector::new();
    detector.feed(bytes, true);
    let guessed = detector.guess(None, false);

    // chardetng 负责判断，encoding_rs 严格解码负责二次验证。GBK 的解码器
    // 同时覆盖 GB18030（包括四字节序列），严格解码失败时不得宣称识别成功。
    if guessed == GBK {
        if let Some(content) = GBK.decode_without_bom_handling_and_without_replacement(bytes) {
            return DecodedText::readonly(
                content.into_owned(),
                "gbk",
                false,
                "检测到 GBK/GB18030 编码，当前版本不支持编辑，已只读打开，不会写回".to_string(),
            );
        }
    }

    // 其他编码只作容错展示，不把启发式猜测暴露为确定编码。
    let (content, _) = guessed.decode_without_bom_handling(bytes);
    DecodedText::readonly(
        content.into_owned(),
        "unknown",
        false,
        format!(
            "无法可靠识别文件编码，已按猜测的 {} 容错解码；内容可能不完整或有乱码，已只读打开，禁止写回",
            guessed.name()
        ),
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use encoding_rs::GB18030;

    #[test]
    fn utf8_with_and_without_bom_is_editable() {
        let plain = decode("# 标题\r\n正文".as_bytes());
        assert_eq!(plain.content, "# 标题\r\n正文");
        assert_eq!(plain.encoding, "utf8");
        assert!(!plain.bom);
        assert!(!plain.readonly);
        assert!(plain.readonly_reason.is_none());

        let with_bom = decode(b"\xEF\xBB\xBF# \xE6\xA0\x87\xE9\xA2\x98\n");
        assert_eq!(with_bom.content, "# 标题\n");
        assert_eq!(with_bom.encoding, "utf8");
        assert!(with_bom.bom);
        assert!(!with_bom.readonly);
    }

    #[test]
    fn utf16_bom_decodes_correctly_and_is_readonly() {
        let text = "# 标题\r\nUTF-16 正文 😀";
        for (bom, little_endian, encoding) in [
            (UTF16LE_BOM, true, "utf16le"),
            (UTF16BE_BOM, false, "utf16be"),
        ] {
            let mut bytes = bom.to_vec();
            for unit in text.encode_utf16() {
                let encoded = if little_endian {
                    unit.to_le_bytes()
                } else {
                    unit.to_be_bytes()
                };
                bytes.extend_from_slice(&encoded);
            }
            let decoded = decode(&bytes);
            assert_eq!(decoded.content, text);
            assert_eq!(decoded.encoding, encoding);
            assert!(decoded.bom);
            assert!(decoded.readonly);
            assert!(decoded.readonly_reason.is_some());
        }
    }

    #[test]
    fn gbk_and_gb18030_decode_correctly_and_are_readonly() {
        let text = "中文编码识别测试：这是一段用于可靠判断 GBK 编码的文本，包含常用汉字与标点。\r\n第二行继续提供足够的上下文。";
        let (gbk_bytes, _, had_errors) = GBK.encode(text);
        assert!(!had_errors);
        let gbk = decode(&gbk_bytes);
        assert_eq!(gbk.content, text);
        assert_eq!(gbk.encoding, "gbk");
        assert!(!gbk.bom);
        assert!(gbk.readonly);

        let text_18030 = format!("{text} GB18030 扩展字符：😀");
        let (bytes_18030, _, had_errors) = GB18030.encode(&text_18030);
        assert!(!had_errors);
        let gb18030 = decode(&bytes_18030);
        assert_eq!(gb18030.content, text_18030);
        assert_eq!(gb18030.encoding, "gbk");
        assert!(gb18030.readonly);

        let short_text = "你好，世界";
        let (short_bytes, _, had_errors) = GBK.encode(short_text);
        assert!(!had_errors);
        let short = decode(&short_bytes);
        assert_eq!(short.content, short_text);
        assert_eq!(short.encoding, "gbk");
        assert!(short.readonly);
    }

    #[test]
    fn unknown_or_malformed_input_is_never_editable() {
        let unknown = decode(&[0x80, 0x81, 0x82, 0xFF]);
        assert_eq!(unknown.encoding, "unknown");
        assert!(unknown.readonly);
        assert!(unknown
            .readonly_reason
            .as_deref()
            .is_some_and(|reason| reason.contains("可能不完整")));

        let malformed_utf8_bom = decode(b"\xEF\xBB\xBF\xFF\xFE\x80");
        assert_eq!(malformed_utf8_bom.encoding, "unknown");
        assert!(malformed_utf8_bom.bom);
        assert!(malformed_utf8_bom.readonly);
    }
}

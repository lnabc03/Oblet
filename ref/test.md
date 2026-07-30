# Oblet 验收文档

## GFM 特性

<br />

* [x] 已完成任务

* [ ] 待办任务

* 普通列表项

| 特性  | 状态     |
| --- | ------ |
| 表格  | ✅      |
| 删除线 | ~~测试~~ |

> 引用块测试
> 第二行

**加粗**、*斜体*、`行内代码`、[链接](https://example.com)

***

## 数学公式

行内公式 $E = mc^2$ 测试。

$$
\int_{-\infty}^{\infty} e^{-x^2} dx = \sqrt{2\pi}
$$

## 代码高亮

```rust
fn main() {
    let msg = "Hello, Oblet";
    println!("{msg}");
}
```

```python
def greet(name: str) -> str:
    return f"Hello, {name}"
```

```unknown-language
这段不应高亮但也不应报错
```


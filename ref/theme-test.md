---
created: 2026-07-30_21:22
updated: 2026-07-30_21:26
---

# 主题定制验收文档

> 本文档用于验证 AnuPpuccin Custom（Style Settings 定制）在 Oblet 中的还原效果。
> 请分别在浅色（Rosé Pine Light）和深色（Mocha Old）模式下过一遍。

## 标题配色（anp-header-color-toggle）

# 一级标题 H1

## 二级标题 H2

### 三级标题 H3

#### 四级标题 H4

##### 五级标题 H5

###### 六级标题 H6

定制开启彩色标题后，各级标题应呈现 Catppuccin 调色板的不同颜色，而非同色。

## Callout（anp-callout-sleek）

> [!note] 笔记
> 这是一个 note callout，sleek 样式下应有简洁的左侧色条与图标。

> [!tip] 提示
> 这是一个 tip callout。

> [!warning] 警告
> 这是一个 warning callout。

> [!question]   
> 这是一个 question callout。

注：v1 的 callout 渲染为普通引用块，sleek 定制效果有限，仅记录观感。

## 高亮（anp-highlight-blue）

这段文字里有 ==应该呈现蓝色高亮的部分==，用于验证高亮颜色定制。

## 列表装饰（anp-decoration-toggle）

- 一级项目符号

  - 二级项目符号

    - 三级项目符号

      - 四级项目符号

- 回到一级

1. 有序列表第一项
2. 有序列表第二项

   1. 嵌套有序
   2. 嵌套有序

- [x] 已完成的任务

- [ ] 未完成的任务
  - [ ] 嵌套任务

## 代码块换行（anp-codeblock-edit-nowrap）

下面代码块含有超长行，nowrap 定制下应出现横向滚动条而非折行：

```python
def a_very_long_function_name_with_many_parameters(parameter_one, parameter_two, parameter_three, parameter_four, parameter_five, parameter_six):
    return f"{parameter_one}-{parameter_two}-{parameter_three}-{parameter_four}-{parameter_five}-{parameter_six} 超长行不换行测试"
```

```rust
fn main() {
    println!("常规长度代码块，观察配色");
}
```

## 行内元素

**加粗**、*斜体*、***粗斜体***、`行内代码`、~~删除线~~、[外部链接](https://catppuccin.com)、[内部链接](#标题配色)。

## 引用块

> 普通引用块第一行
> 第二行
>
> > 嵌套引用块

## 表格

| 名称   | 浅色              | 深色        |
| ---- | :-------------- | --------- |
| 配色方案 | Rosé Pine Light | Mocha Old |
| 强调色  | Flamingo        | Mauve     |

## 数学公式

行内 $a^2 + b^2 = c^2$ 公式。

$$
\sum_{i=1}^{n} i = \frac{n(n+1)}{2}
$$

---

分隔线上下内容，用于观察 hr 样式与段落间距。

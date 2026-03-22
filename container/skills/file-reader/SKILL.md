---
name: file-reader
description: |
  提取 PDF、DOCX、EPUB 等文档文件的文本内容。

  **当以下情况时使用此 Skill**：
  (1) 用户发送了 PDF 文件需要分析内容
  (2) 用户发送了 Word 文档（.docx）需要提取文本
  (3) 用户发送了 EPUB 电子书需要阅读
  (4) 需要从文档中提取纯文本

  **支持的工具**：
  - pdftotext：提取 PDF 文本
  - pandoc：转换 DOCX、EPUB、ODT 等格式为纯文本
allowed-tools: Bash(pdftotext:*), Bash(pandoc:*)
---

# File Reader Skill - 文档文本提取

## 快速使用

### PDF 文件
```bash
pdftotext /path/to/file.pdf -    # 输出到 stdout
pdftotext /path/to/file.pdf output.txt  # 输出到文件
```

### DOCX/Word 文档
```bash
pandoc /path/to/file.docx -t plain   # 输出纯文本到 stdout
pandoc /path/to/file.docx -t markdown  # 转为 Markdown 格式
```

### EPUB 电子书
```bash
pandoc /path/to/file.epub -t plain
```

### ODT/LibreOffice 文档
```bash
pandoc /path/to/file.odt -t plain
```

## 常用参数

### pdftotext 参数
```bash
pdftotext -layout file.pdf -    # 保持原始布局
pdftotext -f 1 -l 5 file.pdf -  # 只提取第1-5页
pdftotext -eol unix file.pdf -  # 使用 Unix 换行符
```

### pandoc 参数
```bash
pandoc file.docx -t plain --wrap=none  # 不自动换行
pandoc file.docx -t markdown --extract-media=./media  # 提取图片
```

## 完整工作流示例

用户发送 PDF 文件后：

1. **下载文件**（使用 `feishu_download_resource` 工具）
   ```
   feishu_download_resource(
     message_id="om_xxx",
     file_key="file_v3_xxx",
     file_name="报告.pdf"
   )
   ```

2. **提取文本**
   ```bash
   pdftotext /path/to/downloaded/报告.pdf -
   ```

3. **分析内容并回复用户**

## 注意事项

- 对于扫描版 PDF（图片型），pdftotext 无法提取文本，需要 OCR 工具
- 复杂排版的 PDF 可能会丢失格式信息
- 加密的 PDF 需要先解密
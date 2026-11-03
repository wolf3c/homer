---
name: homer-local-office
description: Create, edit, or inspect local Word, PowerPoint, Excel and PDF deliverables using the Python libraries bundled with Homer.
---

Use `"$HOMER_BUILTIN_ROOT/python/bin/python3" -B script.py`. The release includes python-docx, python-pptx, openpyxl, pypdf, Pillow and reportlab; no Office account or additional install is needed for local generation. Keep scripts and results inside the current authorized working directory. Do not use a developer venv or Cindy runtime.

Read and edit DOCX with docx, PPTX with pptx, XLSX with openpyxl, PDFs with pypdf; create PDFs with reportlab. These are mature format libraries, not Microsoft Office layout engines. Preserve source files and macros unless explicitly asked to replace them; never execute macros or external links.

For XLSX formulas, openpyxl writes formulas but does not calculate them. Verify formula text and independently calculate/check expected numeric values; say when cached Excel results are absent. Do not present a formula as calculated by Excel. For DOCX/PPTX verify paragraphs/slides and reopen the saved file. For PDF check extracted text and page count. On macOS `qlmanage -t -o <authorized-preview-directory> <document>` can render a system thumbnail; inspect it when layout matters and disclose clipping/renderer limitations.

Deliver the actual .docx/.pptx/.xlsx/.pdf, not only a script or preview. Workers use the existing `stage_workspace_file`, task completion and publication flow. A file on disk alone is not a delivered artifact.

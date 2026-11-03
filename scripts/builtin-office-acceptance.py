"""Real local library I/O in a bundled Python; synthetic non-sensitive document data."""
import hashlib
import json
import os
import sys
from pathlib import Path
from docx import Document
from pptx import Presentation
from openpyxl import Workbook, load_workbook
from pypdf import PdfReader
from reportlab.pdfgen.canvas import Canvas

out = Path(sys.argv[1])
out.mkdir(parents=True, exist_ok=False)
title = 'Homer cold-install office acceptance'
facts = [('Revenue', 120), ('Cost', 90), ('Profit', 30)]

doc = Document()
doc.add_heading(title, 0)
table = doc.add_table(rows=0, cols=2)
for label, number in facts:
    cells = table.add_row().cells
    cells[0].text, cells[1].text = label, str(number)
doc.save(out / 'cold-install-report.docx')
reopened = Document(out / 'cold-install-report.docx')
assert title in '\n'.join(p.text for p in reopened.paragraphs)
assert [int(row.cells[1].text) for row in reopened.tables[0].rows] == [120, 90, 30]

deck = Presentation()
slide = deck.slides.add_slide(deck.slide_layouts[1])
slide.shapes.title.text = title
slide.placeholders[1].text = '\n'.join(f'{label}: {number}' for label, number in facts)
deck.save(out / 'cold-install-report.pptx')
slides = Presentation(out / 'cold-install-report.pptx')
assert len(slides.slides) == 1
text = '\n'.join(shape.text for shape in slides.slides[0].shapes if shape.has_text_frame)
assert all(str(value) in text for _, value in facts)

book = Workbook()
sheet = book.active
sheet.append(['Metric', 'Value'])
sheet.append(['Revenue', 120])
sheet.append(['Cost', 90])
sheet.append(['Profit', '=B2-B3'])
sheet.column_dimensions['A'].width = 24
sheet.column_dimensions['B'].width = 20
book.save(out / 'cold-install-report.xlsx')
values = load_workbook(out / 'cold-install-report.xlsx', data_only=False).active
assert values['B4'].value == '=B2-B3'
assert values['B2'].value - values['B3'].value == 30
assert load_workbook(out / 'cold-install-report.xlsx', data_only=True).active['B4'].value is None

pdf = Canvas(str(out / 'cold-install-report.pdf'))
pdf.setFont('Helvetica', 18)
pdf.drawString(50, 790, title)
pdf.setFont('Helvetica', 14)
for i, (label, number) in enumerate(facts):
    pdf.drawString(50, 740 - i * 30, f'{label}: {number}')
pdf.save()
pages = PdfReader(out / 'cold-install-report.pdf').pages
assert len(pages) == 1
assert all(str(value) in pages[0].extract_text() for _, value in facts)

result = {'passed': True, 'python': sys.version.split()[0], 'coldHome': os.environ.get('HOMER_BUILTIN_ACCEPTANCE') == '1',
          'formatsReopenedAndContentVerified': ['docx', 'pptx', 'xlsx', 'pdf'],
          'xlsxFormulaTextAndIndependentResultVerified': True, 'excelCalculatedCache': False,
          'layoutRendered': False, 'model': False, 'files': []}
for path in sorted(out.iterdir()):
    result['files'].append({'name': path.name, 'bytes': path.stat().st_size,
                            'sha256': hashlib.sha256(path.read_bytes()).hexdigest()})
(out / 'office-verification.json').write_text(json.dumps(result, indent=2) + '\n')
print(json.dumps(result))

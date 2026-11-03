"""Synthetic acceptance inputs only. Requires existing Office readers/writers; installs nothing."""
import os, sys
from docx import Document
from pptx import Presentation
from openpyxl import Workbook
from openpyxl.styles import Font
from pypdf import PdfWriter
from pypdf.generic import DictionaryObject, NameObject, DecodedStreamObject
from PIL import Image, ImageDraw

out = sys.argv[1]
title = 'Homer synthetic office acceptance'
facts = [('Revenue', 120), ('Cost', 90), ('Profit', 30)]
doc = Document()
doc.add_heading(title, 0)
table = doc.add_table(rows=1, cols=2)
table.rows[0].cells[0].text, table.rows[0].cells[1].text = 'Metric', 'Value'
for name, value in facts:
    cells = table.add_row().cells
    cells[0].text, cells[1].text = name, str(value)
doc.save(os.path.join(out, 'synthetic-report.docx'))
deck = Presentation()
slide = deck.slides.add_slide(deck.slide_layouts[1])
slide.shapes.title.text = title
slide.placeholders[1].text = '\n'.join('%s: %s' % fact for fact in facts)
deck.save(os.path.join(out, 'synthetic-report.pptx'))
book = Workbook()
sheet = book.active
sheet.title = 'Metrics'
sheet.append([title])
sheet.merge_cells('A1:B1')
sheet.column_dimensions['A'].width = 34
sheet.column_dimensions['B'].width = 14
sheet['A1'].font = Font(size=12, bold=True)
sheet.print_options.horizontalCentered = True
sheet.sheet_properties.pageSetUpPr.fitToPage = True
sheet.page_setup.fitToWidth = 1
sheet.page_setup.fitToHeight = 1
for fact in facts:
    sheet.append(list(fact))
book.save(os.path.join(out, 'synthetic-report.xlsx'))
writer = PdfWriter()
page = writer.add_blank_page(width=595, height=842)
font = DictionaryObject({NameObject('/Type'): NameObject('/Font'), NameObject('/Subtype'): NameObject('/Type1'), NameObject('/BaseFont'): NameObject('/Helvetica')})
page[NameObject('/Resources')] = DictionaryObject({NameObject('/Font'): DictionaryObject({NameObject('/F1'): writer._add_object(font)})})
stream = DecodedStreamObject()
stream.set_data(('BT /F1 18 Tf 50 780 Td (' + title + ') Tj /F1 14 Tf ' + ''.join('0 -30 Td (%s: %s) Tj ' % fact for fact in facts) + 'ET').encode('ascii'))
page[NameObject('/Contents')] = writer._add_object(stream)
with open(os.path.join(out, 'synthetic-report.pdf'), 'wb') as file:
    writer.write(file)
image = Image.new('RGB', (900, 540), '#f7f6f2')
draw = ImageDraw.Draw(image)
draw.text((36, 32), title, fill='#242424', font_size=26)
for i, (name, value) in enumerate(facts):
    y = 120 + i * 110
    draw.text((36, y), '%s: %s' % (name, value), fill='#242424', font_size=22)
    draw.rectangle((230, y, 230 + value * 4, y + 36), fill='#496c63')
image.save(os.path.join(out, 'synthetic-image.png'))

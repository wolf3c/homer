"""Local bounded readers. stdin is file bytes; no URLs, macros or external links."""
import sys, io, json, zipfile
import resource
resource.setrlimit(resource.RLIMIT_CPU, (15, 15))
MAX_TEXT = 64000
def extract(data, name):
    name = name.lower()
    chunks, limitations = [], []
    def add(label, text):
        if sum(map(len, chunks)) < MAX_TEXT and str(text).strip():
            chunks.append(label + ': ' + str(text)[:MAX_TEXT])
    if data.startswith(b'%PDF-'):
        from pypdf import PdfReader
        reader = PdfReader(io.BytesIO(data), strict=True)
        if reader.is_encrypted: raise ValueError('document_password_required')
        pages = min(len(reader.pages), 100)
        for i in range(pages): add('第%d页' % (i+1), reader.pages[i].extract_text() or '')
        coverage = '%d/%d页；提取文本层' % (pages, len(reader.pages))
        limitations.append('未进行扫描件OCR；嵌入图表和版式未完整解释')
    elif data.startswith(b'PK\x03\x04'):
        with zipfile.ZipFile(io.BytesIO(data)) as z:
            infos = z.infolist()
            if any(i.flag_bits & 1 for i in infos): raise ValueError('document_password_required')
            if len(infos)>2000 or sum(i.file_size for i in infos)>64*1024*1024 or any(i.file_size>16*1024*1024 or i.file_size>max(1,i.compress_size)*200 for i in infos):
                raise ValueError('document_archive_limit')
            names=set(z.namelist())
            if len(names)!=len(infos): raise ValueError('document_archive_limit')
            if any('vbaproject' in n.lower() or n.startswith('/') or '..' in n.split('/') for n in names): raise ValueError('document_active_content_denied')
            if 'word/document.xml' in names:
                from docx import Document
                doc=Document(io.BytesIO(data))
                for i,p in enumerate(doc.paragraphs): add('段落%d'%(i+1),p.text)
                for ti,t in enumerate(doc.tables):
                    for ri,r in enumerate(t.rows): add('表%d行%d'%(ti+1,ri+1),' | '.join(c.text for c in r.cells))
                coverage='正文段落与表格'
            elif 'xl/workbook.xml' in names:
                from openpyxl import load_workbook
                book=load_workbook(io.BytesIO(data),read_only=True,data_only=True,keep_links=False)
                cells=0
                for sheet in book.worksheets[:30]:
                    for row in sheet.iter_rows(max_row=min(sheet.max_row or 1000,1000),max_col=min(sheet.max_column or 50,50)):
                        for c in row:
                            if c.value is not None:
                                add(sheet.title+'!'+c.coordinate,c.value);cells+=1
                                if cells>=10000:break
                        if cells>=10000:break
                    if cells>=10000:break
                book.close();coverage='最多30表/1000行/50列/10000非空单元格'
                limitations.append('公式仅使用文件中已有缓存值；不执行公式，不读取外链')
            elif 'ppt/presentation.xml' in names:
                from pptx import Presentation
                doc=Presentation(io.BytesIO(data));count=min(len(doc.slides),100)
                for i,slide in enumerate(list(doc.slides)[:100]):
                    for shape in slide.shapes:
                        if shape.has_text_frame:add('幻灯片%d'%(i+1),shape.text)
                        if shape.has_table:
                            for ri,r in enumerate(shape.table.rows):add('幻灯片%d表行%d'%(i+1,ri+1),' | '.join(c.text for c in r.cells))
                coverage='%d/%d张幻灯片文本与表格'%(count,len(doc.slides))
            else:raise ValueError('document_unsupported')
            limitations.append('未识别嵌入图片、批注和全部版式；宏不会执行')
    elif name.endswith(('.txt','.md','.csv','.json','.log')):
        if data.startswith((b'\xff\xfe',b'\xfe\xff')):text=data.decode('utf-16')
        else:text=data.decode('utf-8-sig')
        if '\x00' in text or any(ord(c)<32 and c not in '\n\r\t' for c in text):raise ValueError('document_unsupported')
        add('正文',text);coverage='全文文本，最多64000字符'
    else:raise ValueError('document_unsupported')
    text='\n'.join(chunks)
    if not text.strip():limitations.append('没有可提取文本，不能宣称已读懂文件')
    if len(text)>MAX_TEXT:limitations.append('提取内容达到64000字符上限，仅覆盖截取部分')
    return dict(text=text[:MAX_TEXT],coverage=coverage,limitations=limitations,transform='local-document-text-v1')
try:
    data=sys.stdin.buffer.read(50*1024*1024+1)
    if len(data)>50*1024*1024:raise ValueError('document_size_limit')
    result=extract(data,sys.argv[1]);sys.stdout.write(json.dumps(result,ensure_ascii=False))
except Exception as e:
    allowed={'document_password_required','document_archive_limit','document_active_content_denied','document_unsupported','document_size_limit'}
    sys.stdout.write(json.dumps({'error':str(e) if str(e) in allowed else 'document_parse_failed'}));sys.exit(0)

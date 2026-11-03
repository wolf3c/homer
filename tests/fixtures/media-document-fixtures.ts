import {execFileSync} from 'node:child_process';
import {documentPython} from '../../src/media-documents.js';
export async function documents():Promise<[string,Buffer,RegExp][]>{
 const raw=execFileSync(documentPython,['-c',`
import io,json,base64
from docx import Document
from openpyxl import Workbook
from pptx import Presentation
out=[]
d=Document();d.add_paragraph('Dolphin314159');b=io.BytesIO();d.save(b);out.append(['sample.docx',base64.b64encode(b.getvalue()).decode()])
w=Workbook();w.active['B3']='Dolphin314159';b=io.BytesIO();w.save(b);out.append(['sample.xlsx',base64.b64encode(b.getvalue()).decode()])
p=Presentation();s=p.slides.add_slide(p.slide_layouts[0]);s.shapes.title.text='Dolphin314159';b=io.BytesIO();p.save(b);out.append(['sample.pptx',base64.b64encode(b.getvalue()).decode()])
print(json.dumps(out))`],{maxBuffer:2*1024*1024});
 const rows=JSON.parse(raw.toString()).map(([name,data]:string[])=>[name!,Buffer.from(data!,'base64'),/Dolphin314159/] as [string,Buffer,RegExp]);
 const stream='BT /F1 16 Tf 40 700 Td (Dolphin314159) Tj ET';
 const objects=['<< /Type /Catalog /Pages 2 0 R >>','<< /Type /Pages /Kids [3 0 R] /Count 1 >>','<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>','<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`];
 let pdf='%PDF-1.4\n';const offsets=[0];for(const [i,obj]of objects.entries()){offsets.push(Buffer.byteLength(pdf));pdf+=`${i+1} 0 obj\n${obj}\nendobj\n`;}const xref=Buffer.byteLength(pdf);pdf+=`xref\n0 6\n0000000000 65535 f \n${offsets.slice(1).map(n=>String(n).padStart(10,'0')+' 00000 n \n').join('')}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
 return [...rows,['sample.pdf',Buffer.from(pdf),/第1页: Dolphin314159/]];
}
export function documentBoundaries():[string,Buffer,string][] {
 const raw=execFileSync(documentPython,['-c',`
import io,json,zipfile,base64
from pypdf import PdfWriter
out=[]
def emit(name,data,error):out.append([name,base64.b64encode(data).decode(),error])
def archive(entries):
 b=io.BytesIO()
 with zipfile.ZipFile(b,'w',zipfile.ZIP_DEFLATED) as z:
  for name,data in entries:z.writestr(name,data)
 return b.getvalue()
p=PdfWriter();p.add_blank_page(width=100,height=100);p.encrypt('synthetic-password');b=io.BytesIO();p.write(b);emit('encrypted.pdf',b.getvalue(),'document_password_required')
p=PdfWriter();p.add_blank_page(width=100,height=100);b=io.BytesIO();p.write(b);emit('scanned.pdf',b.getvalue(),'empty_text_layer')
emit('macro.docm',archive([('word/document.xml','<synthetic/>'),('word/vbaProject.bin','synthetic-only')]),'document_active_content_denied')
emit('bomb.docx',archive([('word/document.xml','x'*1024*1024)]),'document_archive_limit')
emit('traversal.docx',archive([('../private','synthetic')]),'document_active_content_denied')
emit('duplicate.docx',archive([('word/document.xml','first'),('word/document.xml','second')]),'document_archive_limit')
print(json.dumps(out))`],{maxBuffer:2*1024*1024,stdio:['ignore','pipe','ignore']});
 return JSON.parse(raw.toString()).map(([name,data,error]:string[])=>[name,Buffer.from(data!,'base64'),error]);
}

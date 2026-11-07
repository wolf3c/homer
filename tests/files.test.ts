import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdirSync,mkdtempSync,readFileSync,rmSync,symlinkSync,writeFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {Files} from '../src/files.js';

test('attachment export is exclusive and verified within its Run directory',()=>{
  const scratch=resolve('.codex/scratch/file-exports');mkdirSync(scratch,{recursive:true});
  const base=mkdtempSync(join(scratch,'case-'));
  try{
    const files=new Files(base),dir=files.prepareRun('task-1','run-1');
    assert.equal(dir,join(base,'outputs','task-1','run-1'));
    assert.throws(()=>files.prepareRun('../task-1','run-1'),/id_denied/);
    assert.throws(()=>files.prepareRun('task-1','../run-1'),/id_denied/);
    for(const name of ['../evil.md',join(base,'evil.md')])
      assert.throws(()=>files.writeBinary(dir,name,Buffer.from('text')),/artifact_path_denied/);
    assert.throws(()=>files.writeBinary(dir,'empty.md',Buffer.alloc(0)),/file_type_or_size_denied/);
    const bytes=Buffer.from([0,0x80,0xff]),path=files.writeBinary(dir,'report.bin',bytes);
    assert.deepEqual(readFileSync(path),bytes);
    assert.deepEqual(files.verify(dir,path),{path,bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')});
    assert.throws(()=>files.writeBinary(dir,'report.bin',Buffer.from('overwrite')),/EEXIST/);
    const outside=join(base,'outside.md');writeFileSync(outside,'private');
    assert.throws(()=>files.verify(dir,outside),/artifact_path_denied/);
    const link=join(dir,'link.md');symlinkSync(outside,link);
    assert.throws(()=>files.verify(dir,link),/artifact_path_denied/);
  }finally{rmSync(base,{recursive:true,force:true});}
});

import {readFileSync,realpathSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {createHash} from 'node:crypto';

// Only the verified release entry supplies this in-memory identity. loadConfig
// intentionally does not accept it from JSON or inherited environment.
export type DesktopResourceIdentity={bundleRoot:string;manifestSha256:string};
export function verifiedDesktopResources(identity:DesktopResourceIdentity){
 const root=resolve(identity.bundleRoot),resources=join(root,'Contents/Resources');
 if(realpathSync(root)!==root||realpathSync(process.execPath)!==join(root,'Contents/MacOS/node'))throw Error('desktop_resource_identity_invalid');
 const manifestBytes=readFileSync(join(resources,'desktop-manifest.json'));
 if(createHash('sha256').update(manifestBytes).digest('hex')!==identity.manifestSha256)throw Error('desktop_resource_changed');
 const manifest=JSON.parse(manifestBytes.toString('utf8'));
 const helper=join(root,'Contents/MacOS/homer-image-decoder');
 const codeFiles=['Contents/MacOS/homer-image-decoder','Contents/MacOS/node'].map(path=>{
  const file=join(root,path);if(realpathSync(file)!==file)throw Error('desktop_resource_changed');
  return {path,sha256:createHash('sha256').update(readFileSync(file)).digest('hex')};
 });
 if(JSON.stringify(codeFiles)!==JSON.stringify(manifest.codeFiles))throw Error('desktop_resource_changed');
 const expected=manifest.codeFiles?.find((file:{path:string;sha256:string})=>file.path==='Contents/MacOS/homer-image-decoder')?.sha256;
 if(manifest.format!==2||manifest.node!=='22.22.0'||manifest.codex!=='0.163.0'||!expected||realpathSync(helper)!==helper||createHash('sha256').update(readFileSync(helper)).digest('hex')!==expected)throw Error('desktop_resource_changed');
 return {bundleRoot:root,imageDecoder:helper,imageDecoderSha256:expected as string};
}

// ICNS is a container: preserve PNG bytes for modern slots and use lossless
// legacy RGB/mask slots at 16/32px. This avoids the system ICNS encoder, whose
// failure is independent of otherwise valid ImageIO-readable iconset inputs.
import {mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
export function createDesktopIcon({source,directory,run=(bin,args)=>execFileSync(bin,args,{stdio:'ignore',timeout:30000})}){
 mkdirSync(directory);
 const iconset=join(directory,'Homer.iconset');mkdirSync(iconset);
 const chunks=[];
 const chunk=(type,data)=>{const header=Buffer.alloc(8);header.write(type);header.writeUInt32BE(data.length+8,4);chunks.push(header,data);};
 for(const size of [16,32,128,256,512])for(const scale of [1,2]){
  const pixels=size*scale,png=join(iconset,`icon_${size}x${size}${scale===2?'@2x':''}.png`);
  run('/usr/bin/sips',['-z',String(pixels),String(pixels),source,'--out',png]);
  const bytes=readFileSync(png);
  if(bytes.length<33||bytes.subarray(0,8).toString('hex')!=='89504e470d0a1a0a'||bytes.readUInt32BE(16)!==pixels||bytes.readUInt32BE(20)!==pixels)throw Error('desktop_icon_png_invalid');
  if(scale===1&&size<=32){
   const bmp=join(directory,`icon-${size}.bmp`);run('/usr/bin/sips',['-s','format','bmp',png,'--out',bmp]);
   const b=readFileSync(bmp),offset=b.length>=138?b.readUInt32LE(10):0;
   // sips emits a top-down BITMAPV5 BGRA image with explicit alpha mask.
   // Refuse a changed encoder layout rather than silently lose transparency.
   if(b.length<138||b.toString('ascii',0,2)!=='BM'||b.readUInt32LE(14)!==124||b.readInt32LE(18)!==size||b.readInt32LE(22)!==-size||b.readUInt16LE(26)!==1||b.readUInt16LE(28)!==32||b.readUInt32LE(30)!==3||offset<138||offset+size*size*4>b.length||[0xff0000,0xff00,0xff,0xff000000].some((mask,i)=>b.readUInt32LE(54+i*4)!==mask))throw Error('desktop_icon_bmp_invalid');
   const rgb=Buffer.alloc(size*size*4),alpha=Buffer.alloc(size*size);
   for(let i=0;i<alpha.length;i++){const p=offset+i*4;rgb[i*4+1]=b[p+2];rgb[i*4+2]=b[p+1];rgb[i*4+3]=b[p];alpha[i]=b[p+3];}
   chunk(size===16?'is32':'il32',rgb);chunk(size===16?'s8mk':'l8mk',alpha);
  }else{
   const type=scale===2?({16:'ic11',32:'ic12',128:'ic13',256:'ic14',512:'ic10'})[size]:({128:'ic07',256:'ic08',512:'ic09'})[size];
   chunk(type,bytes);
  }
 }
 const body=Buffer.concat(chunks),header=Buffer.alloc(8);header.write('icns');header.writeUInt32BE(body.length+8,4);
 const icon=join(directory,'Homer.icns');writeFileSync(icon,Buffer.concat([header,body]),{flag:'wx'});return icon;
}

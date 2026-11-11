import {createRequire} from 'node:module';
const sharp=createRequire(new URL('./homer/package.json',import.meta.url))('sharp');
try{
 const args=process.argv.slice(2),crop=args[0]==='crop',edge=args.at(-1);
 if(crop?args.length!==6||!args.slice(1,5).every(value=>/^[0-9]{1,8}$/.test(value))||!['0','600','1100'].includes(edge):
  args.length!==1||!['0','320'].includes(edge))throw Error();
 const chunks=[];let length=0;
 for await(const bytes of process.stdin){length+=bytes.length;if(length>50*1024*1024)throw Error();chunks.push(bytes);}
 let image=sharp(Buffer.concat(chunks),{limitInputPixels:40_000_000,animated:false,failOn:'error'}).rotate();
 if(crop){
  const [left,top,width,height]=args.slice(1,5).map(Number);
  if(width<1||height<1)throw Error();
  image=image.extract({left,top,width,height});
 }
 if(edge!=='0')image=image.resize({width:Number(edge),height:Number(edge),fit:'inside',withoutEnlargement:true});
 process.stdout.write(await image.png().toBuffer());
}catch{process.exitCode=1;}

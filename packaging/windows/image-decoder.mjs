import {createRequire} from 'node:module';
const sharp=createRequire(new URL('./homer/package.json',import.meta.url))('sharp');
try{
 const edge=process.argv[2];if(process.argv.length!==3||!['0','320'].includes(edge))throw Error();
 const chunks=[];let length=0;
 for await(const bytes of process.stdin){length+=bytes.length;if(length>50*1024*1024)throw Error();chunks.push(bytes);}
 let image=sharp(Buffer.concat(chunks),{limitInputPixels:40_000_000,animated:false,failOn:'error'}).rotate();
 if(edge==='320')image=image.resize({width:320,height:320,fit:'inside',withoutEnlargement:true});
 process.stdout.write(await image.png().toBuffer());
}catch{process.exitCode=1;}

import { deflateSync } from 'node:zlib';
function chunk(type,payload){const data=Buffer.concat([Buffer.from(type),payload]);let crc=0xffffffff;for(const v of data){crc^=v;for(let i=0;i<8;i++)crc=(crc>>>1)^(0xedb88320&-(crc&1));}const b=Buffer.alloc(payload.length+12);b.writeUInt32BE(payload.length,0);data.copy(b,4);b.writeUInt32BE((crc^0xffffffff)>>>0,b.length-4);return b;}
const ihdr=Buffer.alloc(13);ihdr.writeUInt32BE(1,0);ihdr.writeUInt32BE(1,4);ihdr[8]=8;ihdr[9]=6;
const png=Buffer.concat([Buffer.from('89504e470d0a1a0a','hex'),chunk('IHDR',ihdr),chunk('IDAT',deflateSync(Buffer.from([0,0,128,128,255]))),chunk('IEND',Buffer.alloc(0))]);
const uri='data:image/png;base64,'+png.toString('base64');

export { png, uri };

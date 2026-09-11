export function resolveUploadReferences(handles, images) {
  if (!Array.isArray(handles) || handles.length !== 1 || !Array.isArray(images)) throw new Error('Select one explicit current-turn image reference.');
  const match=/^upload:(\d+)$/.exec(handles[0]);
  const image=match ? images[Number(match[1])] : null;
  if (!image || image.unsupported || image.type !== 'image/png' || typeof image.data !== 'string' || image.data.length > 12*1024*1024) throw new Error('Unavailable PNG image reference.');
  const bytes=Buffer.from(image.data,'base64');
  if (bytes.length>8*1024*1024 || bytes.length<33 || bytes.toString('base64')!==image.data || bytes.subarray(0,8).toString('hex')!=='89504e470d0a1a0a') throw new Error('Invalid PNG image reference.');
  return ['data:image/png;base64,'+image.data];
}

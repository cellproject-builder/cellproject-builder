const encode = (value: string) => new TextEncoder().encode(value);
/** Original synthetic, uncompressed PDF. Shared image exercises decoded memory without network. */
export function testPdf(kind: 'vector' | 'scan', pages = 20): File {
  const objects: Uint8Array[] = [];
  const imageId = 3 + pages * 2;
  objects.push(encode('<< /Type /Catalog /Pages 2 0 R >>'));
  objects.push(encode(`<< /Type /Pages /Count ${pages} /Kids [${Array.from({length:pages},(_,i)=>`${3+i*2} 0 R`).join(' ')}] >>`));
  for (let i = 0; i < pages; i++) {
    const commands = kind === 'scan' ? 'q 595 0 0 842 0 0 cm /Im0 Do Q\n' : `0.15 0.22 0.35 rg 0 700 595 142 re f\n` + Array.from({length:1800},(_,j)=>`${(j%5)/7} ${(j%7)/9} 0.6 rg ${(j*17)%570} ${(j*23)%680} 12 4 re f\n`).join('');
    objects.push(encode(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources ${kind === 'scan' ? `<< /XObject << /Im0 ${imageId} 0 R >> >>` : '<< >>'} /Contents ${4+i*2} 0 R >>`));
    objects.push(encode(`<< /Length ${encode(commands).length} >>\nstream\n${commands}endstream`));
  }
  if (kind === 'scan') {
    const width=1024,height=1536, pixels=new Uint8Array(width*height*3);
    for(let y=0;y<height;y++) for(let x=0;x<width;x++){const at=(y*width+x)*3; pixels[at]=x%256; pixels[at+1]=y%256; pixels[at+2]=(x+y)%256;}
    const header=encode(`<< /Type /XObject /Subtype /Image /Width ${width} /Height ${height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Length ${pixels.length} >>\nstream\n`), tail=encode('\nendstream');
    const object=new Uint8Array(header.length+pixels.length+tail.length);object.set(header);object.set(pixels,header.length);object.set(tail,header.length+pixels.length);objects.push(object);
  }
  const parts: Uint8Array[]=[encode('%PDF-1.4\n')], offsets=[0]; let length=parts[0].length;
  objects.forEach((object,i)=>{offsets.push(length);const head=encode(`${i+1} 0 obj\n`),tail=encode('\nendobj\n');parts.push(head,object,tail);length+=head.length+object.length+tail.length;});
  const xref=length;parts.push(encode(`xref\n0 ${objects.length+1}\n0000000000 65535 f \n${offsets.slice(1).map(offset=>`${String(offset).padStart(10,'0')} 00000 n \n`).join('')}trailer\n<< /Size ${objects.length+1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`));
  return new File(parts,`synthetic-${kind}-${pages}.pdf`,{type:'application/pdf'});
}

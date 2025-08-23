import fs from 'node:fs';
import path from 'node:path';

export const dynamic = 'force-static';

export async function GET(){
  const filePath = path.join(process.cwd(), 'public', 'data', 'epochs.json');
  const buf = fs.readFileSync(filePath, 'utf8');
  return new Response(buf, { headers: { 'content-type': 'application/json' } });
}



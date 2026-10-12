import { open } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
try {
  const file = await open('.dev.vars', 'wx', 0o600);
  await file.writeFile(`ADMIN_TOKEN=${randomBytes(32).toString('hex')}\n`);
  await file.close();
  console.log('Created an ignored local development ADMIN_TOKEN in .dev.vars. The value is not printed.');
} catch (error) {
  if (error.code !== 'EEXIST') throw error;
  console.log('Existing .dev.vars was preserved.');
}

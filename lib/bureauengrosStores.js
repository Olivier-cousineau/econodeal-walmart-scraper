import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const BRANCHES_PATH = path.join(__dirname, '..', 'data', 'bureauengros', 'branches.json');

export function slugify(value) {
  return value
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
}

export function branchToStore(branch) {
  const slug = `${branch.id}-${slugify(branch.name)}`;
  return {
    id: branch.id,
    slug,
    name: branch.name,
    address: branch.address ?? '',
  };
}

export function getBureauEnGrosStores() {
  const fileContents = fs.readFileSync(BRANCHES_PATH, 'utf8');
  const branches = JSON.parse(fileContents);
  return branches.map(branchToStore);
}

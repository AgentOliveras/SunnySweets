const crypto = require('crypto');
const fs = require('fs');

const audit = JSON.parse(fs.readFileSync('/tmp/forensic-audit.json', 'utf8'));
const recipes = audit.recipes.filter(r => !r.archived);
const masterIngredients = audit.masterIngredients;
const targetHash = 'a2be9232df5b3b3ce08c1fa7f62aacbe290ecc6e2bbc494bfd0cd61bc12a93b7';

const exactMap = new Map();
masterIngredients.forEach(m => {
  const k = m.name.trim().toLowerCase();
  if (!exactMap.has(k)) exactMap.set(k, m);
});

// Let's inspect how manifest was formed
console.log('Target hash:', targetHash);

import fs from 'node:fs';
const required = [
  'public/index.html','public/app.js','public/styles.css','public/_redirects','netlify/functions/api.mjs','netlify/functions/seed.mjs','netlify.toml','package.json'
];
for(const f of required){ if(!fs.existsSync(new URL('../'+f, import.meta.url))) throw new Error(`missing ${f}`); }
const app = fs.readFileSync(new URL('../public/app.js', import.meta.url),'utf8');
if(!app.includes('speechSynthesis')) throw new Error('TTS not wired');
if(!app.includes('pdfjsLib')) throw new Error('PDF upload not wired');
console.log('SB SUNBO chatbot project check OK');

// Assembles the demo build into one self-contained page for publishing as a
// shareable link: the stylesheet and script are inlined into an HTML
// fragment (the publishing host supplies the document skeleton).
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const dist = join(dirname(fileURLToPath(import.meta.url)), '..', 'dist-demo');
const index = readFileSync(join(dist, 'index.html'), 'utf8');
const script = index.match(/<script type="module"[^>]*src="\.?\/?([^"]+)"/)?.[1];
const style = index.match(/<link rel="stylesheet"[^>]*href="\.?\/?([^"]+)"/)?.[1];
if (!script || !style) throw new Error('Could not find the built script and stylesheet in dist-demo/index.html');

const js = readFileSync(join(dist, script), 'utf8').replaceAll('</script', '<\\/script');
const css = readFileSync(join(dist, style), 'utf8').replaceAll('</style', '<\\/style');

const page = `<title>ProductFlow AI Demo</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap">
<style>${css}</style>
<div id="root"></div>
<script type="module">${js}</script>
`;
const out = join(dist, 'productflow-demo.html');
writeFileSync(out, page);
console.log(`Wrote ${out} (${(page.length / 1024).toFixed(0)} KB)`);

// 把網頁檔案複製到 www/（Capacitor 的 webDir），避免把 node_modules、ios 等整包打進 App
const fs = require('fs'), path = require('path');
const root = path.join(__dirname, '..');
const out = path.join(root, 'www');
fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });
for (const f of ['index.html', 'app.js', 'style.css', 'manifest.json', 'sw.js']) {
  fs.copyFileSync(path.join(root, f), path.join(out, f));
}
fs.cpSync(path.join(root, 'icons'), path.join(out, 'icons'), { recursive: true });
console.log('web assets copied to www/');

'use strict';
const fs=require('node:fs');const path=require('node:path');
const root=path.resolve(__dirname,'..');const dest=path.join(__dirname,'ui');
fs.mkdirSync(dest,{recursive:true});fs.cpSync(path.join(root,'renderer'),dest,{recursive:true});
fs.copyFileSync(path.join(root,'security','account-view.js'),path.join(dest,'account-view.js'));
fs.copyFileSync(path.join(__dirname,'bridge.js'),path.join(dest,'bridge.js'));
const platform=require(path.join(root,'package.json')).name==='kickterino'?'kick':'twitch';
fs.writeFileSync(path.join(dest,'platform.js'),`window.TERINO_PLATFORM=${JSON.stringify(platform)};\n`);
const index=path.join(dest,'index.html');
fs.writeFileSync(index,fs.readFileSync(index,'utf8')
  .replace(/\s*<meta http-equiv="Content-Security-Policy"[^>]*>/,'')
  .replace('<script src="../security/account-view.js"></script>','<script src="platform.js"></script>\n  <script src="bridge.js"></script>\n  <script src="account-view.js"></script>')
  .replace('</head>','<link rel="stylesheet" href="prototype.css">\n</head>'));
fs.writeFileSync(path.join(dest,'prototype.css'),'.prototype-badge{font-size:9px;margin-left:6px;padding:2px 4px;border:1px solid currentColor;border-radius:4px;opacity:.8}.prototype-disabled{opacity:.5}');
console.log(`UI preparada: ${platform}; arquivos Electron preservados.`);

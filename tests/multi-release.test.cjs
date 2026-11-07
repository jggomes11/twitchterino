'use strict';
const {test}=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const path=require('node:path');const vm=require('node:vm');
test('Windows package offers one launcher for all four accounts with no account-specific shortcuts',()=>{
 const source=fs.readFileSync(path.join(__dirname,'../scripts/package-windows-release.cjs'),'utf8');
 assert(!source.includes('for (let profile = 1; profile <= 4; profile++)'), 'Package still generates four process launchers');
 const writes=new Map(),output='stage';
 const start=source.indexOf('const launcher =');const end=source.indexOf('const sourceSha =');
 assert(start>0,'Expected a single application launcher');
 vm.runInNewContext(source.slice(start,end),{fs:{writeFileSync:(file,text)=>writes.set(file,text)},path,output,pkg:{version:'0.1.3'}});
 const launchers=[...writes.keys()].filter(file=>file.endsWith('.cmd'));
 assert.equal(launchers.length,1);assert(launchers[0].endsWith('Abrir-Twitchterino.cmd'));
 assert.match(writes.get(launchers[0]),/Twitchterino-Accounts/);
 const readme=writes.get(path.join(output,'portable','LEIA-ME.txt'));
 assert.match(readme,/mesma janela/);assert.match(readme,/conta diferente/);assert(!readme.includes('Abrir-Conta-'));
});

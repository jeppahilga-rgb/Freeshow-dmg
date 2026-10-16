import fs from 'node:fs/promises'
import path from 'node:path'
import {execFileSync,spawnSync} from 'node:child_process'
const base='98b5e19956ef61fb9df1ca5ae361898def87f63d',target='v1.6.7-beta.1'
const backup=path.resolve('../output/upstream-port-1.6.7-beta.1-backup')
await fs.mkdir(backup,{recursive:true})
const changes=execFileSync('git',['diff','--name-status','-M',base,target],{encoding:'utf8'}).trim().split('\n').map(line=>line.trim().split('\t'))
const records=[]
const gitFile=(ref,file)=>execFileSync('git',['show',`${ref}:${file}`],{maxBuffer:16*1024*1024})
for(const [status,oldPath,newPath] of changes){
 const file=status.startsWith('R')?newPath:oldPath,source=status.startsWith('R')?oldPath:file
 if(['package.json','package-lock.json'].includes(file)){records.push({file,status,action:'version-only merge; preserve Tauri dependencies'});continue}
 const prior=await fs.readFile(source).catch(()=>Buffer.alloc(0)),originalPath=path.join(backup,source)
 await fs.mkdir(path.dirname(originalPath),{recursive:true});try{await fs.writeFile(originalPath,prior,{flag:'wx'})}catch(error){if(error.code!=='EEXIST')throw error}
 if(status==='D'){records.push({file,status,action:'retained old file pending import review'});continue}
 const normalize=bytes=>Buffer.from(bytes.toString('utf8').replaceAll('\r\n','\n'))
 const theirs=normalize(gitFile(target,file))
 let merged=theirs,exit=0
 if(status!=='A'){
  const ancestor=normalize(gitFile(base,source)),work=path.join(backup,'merge',file);await fs.mkdir(path.dirname(work),{recursive:true})
  for(const [suffix,bytes] of [['ours',normalize(prior)],['base',ancestor],['theirs',theirs]])await fs.writeFile(work+'.'+suffix,bytes)
  const result=spawnSync('git',['merge-file','--diff3','-p',work+'.ours',work+'.base',work+'.theirs'],{maxBuffer:16*1024*1024});exit=result.status
  if(exit===null||exit<0||exit>127)throw Error('Merge failed: '+file)
  merged=result.stdout
  if(exit!==0){await fs.writeFile(work+'.conflict',merged);records.push({file,status,action:'conflict: local file preserved',conflicts:exit,review:work+'.conflict'});continue}
 }
 await fs.mkdir(path.dirname(file),{recursive:true});await fs.writeFile(file,merged);records.push({file,status,action:'merged'})
}
await fs.writeFile(path.join(backup,'manifest.json'),JSON.stringify({base,target,targetCommit:execFileSync('git',['rev-parse',target],{encoding:'utf8'}).trim(),records},null,2))
console.log(JSON.stringify({files:records.length,merged:records.filter(r=>r.action==='merged').length,conflicts:records.filter(r=>r.conflicts)},null,2))

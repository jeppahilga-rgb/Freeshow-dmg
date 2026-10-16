import fs from 'node:fs/promises'
const root='tauri-test-output/drive-library/'
const backup='tauri-test-output/local-packaged-backup.json'
if(process.argv[2]==='restore'){
    const saved=JSON.parse(await fs.readFile(backup,'utf8'))
    for(const [name,text] of Object.entries(saved))await fs.writeFile(root+name,text)
}else{
    const saved={}
    for(const name of ['SETTINGS.json','STAGE.json'])saved[name]=await fs.readFile(root+name,'utf8')
    await fs.writeFile(backup,JSON.stringify(saved))
    const settings=JSON.parse(saved['SETTINGS.json'])
    const id='connections-probe'
    settings.outputs={[id]:{id,name:'Local connection test',enabled:true,active:false,bounds:{x:50,y:50,width:640,height:360},boundsLocked:true,alwaysOnTop:false,out:{}}}
    settings.disabledServers={remote:true,stage:true,controller:true,output_stream:true}
    settings.serverData={remote:{password:'fixture-remote'},companion:{enabled:false,password:'fixture-api'},output_stream:{outputId:id}}
    await fs.writeFile(root+'SETTINGS.json',JSON.stringify(settings))
    await fs.writeFile(root+'STAGE.json',JSON.stringify({fixture:{name:'Stage connection fixture',password:'fixture-stage',settings:{output:id},items:{current_output:{type:'current_output',enabled:true,align:'center',style:'width:1920px;height:1080px;left:0;top:0;'}}}}))
}

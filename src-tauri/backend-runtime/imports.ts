import path from 'node:path'
import fs from 'node:fs'
import {importShow} from '../../src/electron/data/import'
const formats=new Set(['word','propresenter','easyworship','openlp','mediashout','quelea','softprojector','videopsalm','freeshow_project','freeshow_template','freeshow_overlay','BIBLE'])
export async function importBinary(data:any){
 if(!formats.has(data.kind))throw Error('Unknown binary import format')
 if(!Array.isArray(data.paths)||!data.paths.length||data.paths.length>1000)throw Error('Select files to import')
 for(const file of data.paths){if(typeof file!=='string'||!path.isAbsolute(file)||!fs.statSync(file).isFile())throw Error('Invalid import file')}
 await importShow(data.kind,data.paths)
}

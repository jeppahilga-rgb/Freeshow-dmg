import {DatabaseSync} from 'node:sqlite'
// Match the readonly subset used by the original song/Bible importer.
export default class Database {
 private database:DatabaseSync
 constructor(filename:string,options:{readonly?:boolean}={}){this.database=new DatabaseSync(filename,{readOnly:options.readonly!==false,allowExtension:false});this.database.exec('PRAGMA query_only = ON')}
 prepare(query:string){return this.database.prepare(query)}
 close(){this.database.close()}
}

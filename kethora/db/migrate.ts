import {readFile,readdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {join} from 'node:path';
import pg from 'pg';

// Migration identity is provisioned separately. No agent process calls this entry point.
const url=process.env.KETHORA_MIGRATION_DATABASE_URL;
if(!url)throw new Error('KETHORA_MIGRATION_DATABASE_URL required (value is never logged)');
const pool=new pg.Pool({connectionString:url,max:1});
try {
  const files=(await readdir(join(process.cwd(),'db/migrations'))).filter(f=>/^\d+_.*\.sql$/.test(f)).sort();
  for(const file of files){
    const version=Number(file.split('_')[0]);const sql=await readFile(join(process.cwd(),'db/migrations',file),'utf8');
    const sha=createHash('sha256').update(sql).digest('hex');
    const exists=await pool.query("SELECT to_regclass('kethora.schema_migrations') AS table_name");
    if(exists.rows[0]?.table_name){
      const previous=await pool.query('SELECT sha256 FROM kethora.schema_migrations WHERE version=$1',[version]);
      if(previous.rowCount){if(previous.rows[0].sha256!==sha)throw new Error(`Migration ${version} changed after application`);continue;}
    }
    await pool.query(sql); // The SQL file owns BEGIN/COMMIT, including DDL.
    await pool.query('INSERT INTO kethora.schema_migrations(version,sha256) VALUES($1,$2)',[version,sha]);
    process.stdout.write(`Applied migration ${version} (${sha})\n`);
  }
}finally{await pool.end();}

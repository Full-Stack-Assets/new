import {fileURLToPath} from 'node:url';
import {NativeConnection,Worker} from '@temporalio/worker';
import {join,dirname} from 'node:path';
import pg from 'pg';
import {eventReader} from './activities.js';

const buildId=process.env.KETHORA_WORKER_BUILD_ID;
if(!buildId||!process.env.KETHORA_TEMPORAL_ADDRESS)throw new Error('Pinned deployment build ID and Temporal address required');
if(!process.env.KETHORA_WORKFLOW_DATABASE_URL)throw new Error('Scoped workflow database identity required');
const pool=new pg.Pool({connectionString:process.env.KETHORA_WORKFLOW_DATABASE_URL,max:4});
const connection=await NativeConnection.connect({address:process.env.KETHORA_TEMPORAL_ADDRESS});
const worker=await Worker.create({
  connection,namespace:'default',taskQueue:'kethora-task-v1',
  workflowsPath:join(dirname(fileURLToPath(import.meta.url)),'workflows.js'),
  workerDeploymentOptions:{version:{deploymentName:'kethora-task',buildId},useWorkerVersioning:true,defaultVersioningBehavior:'PINNED'},
  activities:{inspectCommittedEvent:eventReader(pool)},
});
try{await worker.run();}finally{await pool.end();await connection.close();}

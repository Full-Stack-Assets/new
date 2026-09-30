import {defineConfig} from '@playwright/test';
export default defineConfig({
 testDir:'tests/e2e',fullyParallel:false,workers:1,timeout:30000,
 reporter:[['list'],['json',{outputFile:'docs/receipts/web-e2e-results.json'}]],
 use:{baseURL:'http://127.0.0.1:8788',trace:'retain-on-failure',launchOptions:{...(process.env.KETHORA_CHROMIUM_PATH?{executablePath:process.env.KETHORA_CHROMIUM_PATH}:{}),args:['--no-sandbox']}},
 webServer:{command:'node dist/services/api/src/server.js',port:8788,reuseExistingServer:false,env:{PORT:'8788',KETHORA_LOCAL_DB:'/tmp/kethora-e2e.sqlite'},timeout:15000},
 projects:[{name:'desktop',use:{viewport:{width:1440,height:1000}}},{name:'mobile',use:{viewport:{width:390,height:844},isMobile:true,hasTouch:true}}]
});

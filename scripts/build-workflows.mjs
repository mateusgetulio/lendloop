import { writeFileSync } from "node:fs";
const verify = String.raw`const crypto=require('crypto');
const input=$input.first().json,headers=input.headers||{},body=input.body;
const reject=status=>[{json:{valid:false,status}}];
if(Number(headers['content-length']||0)>65536)return reject(413);
const raw=await this.helpers.getBinaryDataBuffer(0,'data');if(raw.length>65536)return reject(413);
if(!body||Array.isArray(body)||Object.keys(body).length!==1||typeof body.payload!=='string')return reject(400);
const timestamp=headers['x-lendloop-timestamp']||'',signature=headers['x-lendloop-signature']||'';
if(!/^(0|[1-9]\d{0,12})$/.test(timestamp)||Math.abs(Date.now()/1000-Number(timestamp))>300||!/^v1=[a-f0-9]{64}$/.test(signature))return reject(401);
const expected=crypto.createHmac('sha256',$env.CONVEX_TO_N8N_SECRET).update('v1\n'+timestamp+'\nnotify\n'+body.payload,'utf8').digest();
if(!crypto.timingSafeEqual(expected,Buffer.from(signature.slice(3),'hex')))return reject(401);
let payload;try{payload=JSON.parse(body.payload);}catch{return reject(400);}
const keys=['eventId','type','loanId','recipientId','toolName','status','startDate','endDate'];
if(!payload||Array.isArray(payload)||Object.keys(payload).length!==keys.length||keys.some(k=>typeof payload[k]!=='string')||Object.keys(payload).some(k=>!keys.includes(k)))return reject(400);
const status={requested:'pending',approved:'approved',declined:'declined',cancelled:'cancelled',returned:'returned'};
if(status[payload.type]!==payload.status||['eventId','loanId','recipientId'].some(k=>!payload[k]||payload[k].length>80)||!payload.toolName||payload.toolName.length>100||!/^\d{4}-\d{2}-\d{2}$/.test(payload.startDate)||!/^\d{4}-\d{2}-\d{2}$/.test(payload.endDate))return reject(400);
return [{json:{valid:true,payload}}];`;
const signing = String.raw`const crypto=require('crypto');
function signed(value,purpose){const payload=JSON.stringify(value),timestamp=String(Math.floor(Date.now()/1000));const signature='v1='+crypto.createHmac('sha256',$env.N8N_TO_CONVEX_SECRET).update('v1\n'+timestamp+'\n'+purpose+'\n'+payload,'utf8').digest('hex');return {timestamp,signature,envelope:JSON.stringify({payload})};}
`;
const format =
  signing +
  String.raw`const value=$input.first().json.payload;
const day=d=>new Date(d+'T00:00:00Z').toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric',timeZone:'UTC'});
const dates=value.startDate===value.endDate?day(value.startDate):day(value.startDate)+' to '+day(value.endDate);
const texts={requested:'New request to borrow '+value.toolName+' for '+dates+'.',approved:'Your request to borrow '+value.toolName+' for '+dates+' was approved.',declined:'Your request to borrow '+value.toolName+' for '+dates+' was declined.',cancelled:'The loan of '+value.toolName+' for '+dates+' was cancelled.',returned:value.toolName+' was marked as returned. Thanks for borrowing.'};
const message=texts[value.type].slice(0,500);
console.log('Formatted request notification');
return [{json:signed({eventId:value.eventId,message,n8nExecutionId:String($execution.id)},'notification-result')}];`;
const errorCode =
  signing +
  String.raw`const value=$input.first().json;
return [{json:signed({workflow:value.workflow?.id==='LendLoopNotify'?'request-notifications':'overdue-reminders',executionId:String(value.execution?.id||$execution.id),node:'execution-failed',message:'Workflow execution failed. Inspect the private execution record.'},'failure-report')}];`;
function node(name, type, parameters, x, y = 0, typeVersion = 1) {
  return {
    id: name.replaceAll(" ", "-"),
    name,
    type: "n8n-nodes-base." + type,
    typeVersion,
    position: [x, y],
    parameters,
  };
}
function code(name, js, x, y = 0) {
  return node(name, "code", { jsCode: js }, x, y, 2);
}
function http(name, path, x, y = 0, continueFailure = false) {
  return {
    ...node(
      name,
      "httpRequest",
      {
        method: "POST",
        url:
          "={{ $env.LENDLOOP_CONVEX_HTTP_URL + '/automation/" + path + "' }}",
        sendHeaders: true,
        headerParameters: {
          parameters: [
            { name: "X-LendLoop-Timestamp", value: "={{ $json.timestamp }}" },
            { name: "X-LendLoop-Signature", value: "={{ $json.signature }}" },
          ],
        },
        sendBody: true,
        contentType: "raw",
        rawContentType: "application/json",
        body: "={{ $json.envelope }}",
        options: { timeout: 30000 },
      },
      x,
      y,
      4.2,
    ),
    retryOnFail: true,
    maxTries: 3,
    waitBetweenTries: 1000,
    ...(continueFailure ? { onError: "continueRegularOutput" } : {}),
  };
}
function iff(name, expression, x, y = 0) {
  return node(
    name,
    "if",
    {
      conditions: {
        options: { caseSensitive: true, typeValidation: "strict", version: 2 },
        conditions: [
          {
            id: name,
            leftValue: expression,
            rightValue: true,
            operator: { type: "boolean", operation: "true", singleValue: true },
          },
        ],
        combinator: "and",
      },
      options: {},
    },
    x,
    y,
    2.2,
  );
}
const edge = (name) => ({ node: name, type: "main", index: 0 });
const connections = {};
function link(from, to, branch = 0) {
  connections[from] ??= { main: [] };
  connections[from].main[branch] ??= [];
  connections[from].main[branch].push(edge(to));
}
const a = [
  node(
    "Request webhook",
    "webhook",
    {
      httpMethod: "POST",
      path: "lendloop-notify",
      responseMode: "responseNode",
      options: { rawBody: true },
    },
    0,
    0,
    2,
  ),
  code("Verify signature", verify, 200),
  iff("Valid request", "={{ $json.valid }}", 400),
  node(
    "Accept request",
    "respondToWebhook",
    {
      respondWith: "json",
      responseBody: '{"accepted":true}',
      options: { responseCode: 200 },
    },
    1000,
    0,
    1.4,
  ),
  code("Format notification", format, 600),
  http("Deliver notification", "notifications", 800, 0, true),
  code(
    "Check delivery",
    "if($input.first().json.error)throw new Error('Notification callback failed.');return $input.all();",
    1200,
  ),
  node(
    "Reject request",
    "respondToWebhook",
    {
      respondWith: "json",
      responseBody: '{"accepted":false}',
      options: { responseCode: "={{ $json.status }}" },
    },
    600,
    220,
    1.4,
  ),
];
a[0].webhookId = "lendloop-notify";
link("Request webhook", "Verify signature");
link("Verify signature", "Valid request");
link("Valid request", "Format notification");
link("Valid request", "Reject request", 1);
link("Format notification", "Deliver notification");
link("Deliver notification", "Accept request");
link("Accept request", "Check delivery");
function workflow(id, name, nodes, links, error = true) {
  return {
    id,
    name,
    active: false,
    nodes,
    connections: links,
    settings: {
      executionOrder: "v1",
      ...(error ? { errorWorkflow: "LendLoopError" } : {}),
    },
  };
}
writeFileSync(
  "n8n/workflows/request.json",
  JSON.stringify(
    workflow("LendLoopNotify", "Request notifications", a, connections),
    null,
    2,
  ) + "\n",
);
for (const key of Object.keys(connections)) delete connections[key];
const prepare =
  signing +
  `const value=$input.first().json;return [{json:{cursor:value.cursor??null,pages:value.pages??0,failedCount:value.failedCount??0,...signed({cursor:value.cursor??null,limit:50},'overdue-fetch')}}];`;
const processPage = String.raw`const page=$input.first().json,state=$('Prepare fetch').all(0,$runIndex)[0].json;
if(!Array.isArray(page.loans)||typeof page.isDone!=='boolean')throw new Error('Invalid overdue response');
const next={cursor:page.cursor,pages:state.pages+1,failedCount:state.failedCount,isDone:page.isDone};
return page.loans.length?page.loans.map(loan=>({json:{...loan,state:next}})):[{json:{skip:true,state:next}}];`;
const signReminders =
  signing +
  String.raw`return $input.all().map(item=>{const loan=item.json;console.log('Formatted overdue reminder');return {json:signed({loanId:loan.loanId,reminderKey:loan.reminderKey,message:('Please return '+loan.toolName+'. It was due on '+new Date(loan.endDate+'T00:00:00Z').toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric',timeZone:'UTC'})+'.').slice(0,500),n8nExecutionId:String($execution.id)},'reminder-result')};});`;
const collect = String.raw`const state=$('Process page').all(0,$runIndex)[0].json.state;
const failed=$input.all().filter(item=>item.json.error||item.json.result==='stale').length;
return [{json:{...state,failedCount:state.failedCount+failed,more:!state.isDone&&state.pages<20,capped:!state.isDone&&state.pages>=20,report:state.failedCount+failed>0||!state.isDone&&state.pages>=20}}];`;
const report =
  signing +
  String.raw`const state=$input.first().json;return [{json:signed({workflow:'overdue-reminders',executionId:String($execution.id),node:state.capped?'page-cap':'item-failed',message:state.capped?'Reminder scan exceeded its page limit.':'Some reminder callbacks failed.'},'failure-report')}];`;
const b = [
  node(
    "Daily and recovery schedule",
    "scheduleTrigger",
    {
      rule: {
        interval: [
          { field: "cronExpression", expression: "0 9 * * *" },
          { field: "cronExpression", expression: "0 10-17 * * *" },
        ],
      },
    },
    0,
    0,
    1.2,
  ),
  node("Run now", "manualTrigger", {}, 0, 180),
  code("Prepare fetch", prepare, 200),
  http("Fetch overdue", "overdue", 400),
  code("Process page", processPage, 600),
  iff("Has reminder", "={{ !$json.skip }}", 800),
  code("Format reminders", signReminders, 1000),
  http("Deliver reminder", "reminders", 1200, 0, true),
  code("Collect failures", collect, 1400),
  iff("More pages", "={{ $json.more }}", 1600),
  iff("Report failures", "={{ $json.report }}", 1800),
  code("Format failure report", report, 2000),
  http("Report reminder failure", "failures", 2200),
  node("Finished", "noOp", {}, 2400),
];
link("Daily and recovery schedule", "Prepare fetch");
link("Run now", "Prepare fetch");
link("Prepare fetch", "Fetch overdue");
link("Fetch overdue", "Process page");
link("Process page", "Has reminder");
link("Has reminder", "Format reminders");
link("Has reminder", "Collect failures", 1);
link("Format reminders", "Deliver reminder");
link("Deliver reminder", "Collect failures");
link("Collect failures", "More pages");
link("More pages", "Prepare fetch");
link("More pages", "Report failures", 1);
link("Report failures", "Format failure report");
link("Report failures", "Finished", 1);
link("Format failure report", "Report reminder failure");
link("Report reminder failure", "Finished");
writeFileSync(
  "n8n/workflows/overdue.json",
  JSON.stringify(
    workflow(
      "LendLoopOverdue",
      "Overdue reminders",
      b,
      structuredClone(connections),
    ),
    null,
    2,
  ) + "\n",
);
for (const key of Object.keys(connections)) delete connections[key];
link("Error trigger", "Format execution failure");
link("Format execution failure", "Report execution failure");
writeFileSync(
  "n8n/workflows/error.json",
  JSON.stringify(
    workflow(
      "LendLoopError",
      "Workflow errors",
      [
        node("Error trigger", "errorTrigger", {}, 0),
        code("Format execution failure", errorCode, 200),
        http("Report execution failure", "failures", 400),
      ],
      connections,
      false,
    ),
    null,
    2,
  ) + "\n",
);
console.log("Generated three self-contained workflow definitions");

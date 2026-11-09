"""Disposable integration stack. No connection to a user's database or PayPal account.
Requires test-only PGlite socket CLI, Qdrant binary, moto[server], boto3, psycopg[binary].
See docs/ibnu/TESTING.md. Production continues to use root docker-compose.yml.
"""
import argparse
import io
import json
import os
from pathlib import Path
import socket
import subprocess
import sys
import tempfile
import time
import traceback
import uuid
import httpx
import psycopg
import boto3
from pypdf import PdfWriter
from pypdf.generic import DictionaryObject, NameObject, DecodedStreamObject

ROOT = Path(__file__).resolve().parents[2]
AI = ROOT / "apps/ai"
API = ROOT / "apps/api"
WEB = ROOT / "apps/web"
CHECKS = []

def check(name, condition):
    if not condition: raise AssertionError(name)
    CHECKS.append({"name": name, "passed": True});print("PASS", name, flush=True)
def free_port():
    with socket.socket() as s:s.bind(("127.0.0.1",0));return s.getsockname()[1]
def wait_for(fn, timeout=60):
    deadline=time.time()+timeout
    while time.time()<deadline:
        try:
            value=fn()
            if value:return value
        except (httpx.TransportError, psycopg.OperationalError):pass
        time.sleep(.2)
    raise TimeoutError("Timed out waiting for integration condition")
def pdf(text):
    w=PdfWriter();p=w.add_blank_page(width=612,height=792)
    p[NameObject('/Resources')]=DictionaryObject({NameObject('/Font'):DictionaryObject({NameObject('/F1'):DictionaryObject({NameObject('/Type'):NameObject('/Font'),NameObject('/Subtype'):NameObject('/Type1'),NameObject('/BaseFont'):NameObject('/Helvetica')})})})
    stream=DecodedStreamObject();escaped=text.replace('\\','\\\\').replace('(','\\(').replace(')','\\)')
    stream.set_data(f'BT /F1 12 Tf 40 700 Td ({escaped}) Tj ET'.encode());p[NameObject('/Contents')]=w._add_object(stream)
    out=io.BytesIO();w.write(out);return out.getvalue()

class Stack:
    def __init__(self,args):
        self.args=args;self.processes=[];self.temp=Path(tempfile.mkdtemp(prefix='velapal-integration-'));self.logs=[]
        self.ports={k:free_port() for k in ['db','qdrant','s3','api','ai','web']}
        self.db=f"postgresql://postgres:postgres@127.0.0.1:{self.ports['db']}/postgres?schema=public&connection_limit=1&statement_cache_size=0&sslmode=disable"
        self.dsn=self.db.split('?')[0]
        self.api=f"http://127.0.0.1:{self.ports['api']}";self.ai=f"http://127.0.0.1:{self.ports['ai']}"
        self.q=f"http://127.0.0.1:{self.ports['qdrant']}";self.s3=f"http://127.0.0.1:{self.ports['s3']}"
        self.env={**os.environ,'DATABASE_URL':self.db,'S3_ENDPOINT':self.s3,'S3_ACCESS_KEY':'test-access','S3_SECRET_KEY':'test-secret',
            'S3_BUCKET':'velapal-integration','S3_REGION':'us-east-1','AI_SERVICE_URL':self.ai,'API_INTERNAL_BASE_URL':self.api,
            'WORKER_TO_AI_SECRET':'integration-worker-token','AI_TO_EXPRESS_SECRET':'integration-callback-token','MANIFEST_HMAC_SECRET':'integration-manifest-secret',
            'AI_MODEL_MODE':'fixture','AI_BUSINESS_DATA_MODE':'synthetic_fixture','QDRANT_URL':self.q,'AI_DATA_DIR':str(self.temp/'ai-data'),
            'PORT':str(self.ports['api']),'OUTBOX_POLL_MS':'150','WEB_ORIGIN':f"http://127.0.0.1:{self.ports['web']}",
            'NEXT_PUBLIC_API_MODE':'api','API_UPSTREAM':self.api,'NEXT_PUBLIC_API_BASE_URL':'/api/v1','NEXT_TELEMETRY_DISABLED':'1'}
        self.client=httpx.Client(trust_env=False,timeout=20)
    def start(self,name,cmd,cwd,extra=None):
        log=open(self.temp/(name+'.log'),'w');self.logs.append(log)
        p=subprocess.Popen(cmd,cwd=cwd,env={**self.env,**(extra or {})},stdout=log,stderr=subprocess.STDOUT)
        self.processes.append((name,p));return p
    def stop(self,p):
        if p.poll() is None:
            p.terminate()
            try:p.wait(10)
            except subprocess.TimeoutExpired:p.kill();p.wait()
    def sql(self,query,args=()):
        with psycopg.connect(self.dsn,autocommit=True) as db:
            cur=db.execute(query,args)
            return cur.fetchall() if cur.description else []
    def cli(self,args,cwd):
        r=subprocess.run(args,cwd=cwd,env=self.env,capture_output=True,text=True,timeout=90)
        if r.returncode:raise RuntimeError(r.stdout[-1200:]+r.stderr[-1200:])
    def start_ai(self):
        p=self.start('ai-'+str(len(self.processes)),[sys.executable,'-m','uvicorn','velapal_ai.main:app','--host','127.0.0.1','--port',str(self.ports['ai'])],AI)
        wait_for(lambda:self.client.get(self.ai+'/health').status_code==200);return p
    def setup(self):
        self.start('postgres',['node',str(Path(self.args.pglite_cli).resolve()),'--port='+str(self.ports['db']),'--host=127.0.0.1','--max-connections=10'],ROOT)
        wait_for(lambda:self.sql('SELECT 1'))
        self.start('qdrant',[str(Path(self.args.qdrant_binary).resolve()),'--disable-telemetry'],self.temp,
            {'QDRANT__SERVICE__HOST':'127.0.0.1','QDRANT__SERVICE__HTTP_PORT':str(self.ports['qdrant']),
             'QDRANT__SERVICE__GRPC_PORT':str(free_port()),'QDRANT__STORAGE__STORAGE_PATH':str(self.temp/'qdrant')})
        wait_for(lambda:self.client.get(self.q+'/readyz').status_code==200)
        self.start('s3',[sys.executable,'-m','moto.server','-H','127.0.0.1','-p',str(self.ports['s3'])],self.temp)
        wait_for(lambda:self.client.get(self.s3).status_code==200)
        boto3.client('s3',endpoint_url=self.s3,region_name='us-east-1',aws_access_key_id='test-access',aws_secret_access_key='test-secret').create_bucket(Bucket='velapal-integration')
        self.cli(['node','node_modules/prisma/build/index.js','db','push'],API)
        self.cli(['node','node_modules/typescript/bin/tsc'],API)
        self.cli(['node','dist/prisma/seed.js'],API)
        self.sql('DEALLOCATE ALL')  # PGlite multiplexes clients into one session; clear seed prepared statements.
        self.ai_process=self.start_ai()
        self.api_process=self.start('express',['node','dist/src/server.js'],API)
        wait_for(lambda:self.client.get(self.api+'/health').status_code==200)
        wait_for(lambda:self.client.get(self.ai+'/ready').status_code==200)
    def login(self,role):
        c=httpx.Client(base_url=self.api+'/api/v1/',trust_env=False,timeout=20)
        r=c.post('auth/login',json={'email':f'{role}@velapal.demo','password':'correct-horse-battery-staple'});r.raise_for_status();d=r.json()['data']
        if d['status']=='MFA_REQUIRED':d=c.post('auth/mfa/verify',json={'challengeId':d['challengeId'],'code':'123456'}).json()['data']
        c.headers['X-CSRF-Token']=d['csrfToken'];return c
    def data(self,c,method,path,body=None,version=None):
        headers={'If-Match':str(version)} if version is not None else {}
        if method in ['POST','PUT','PATCH','DELETE']:headers['Idempotency-Key']='itest_'+uuid.uuid4().hex
        r=c.request(method,path,json=body,headers=headers)
        if r.status_code>=400:raise AssertionError(f'{method} {path} -> {r.status_code}: {r.text[:350]}')
        return r.json()['data']
    def run_result(self,c,run_id):
        return wait_for(lambda:(lambda d:d if d['status'] not in ['QUEUED','RUNNING'] else None)(self.data(c,'GET','agent/runs/'+run_id)),75)
    def index_done(self,sid):
        def done():
            rows=self.sql('SELECT state FROM "OutboxJob" WHERE "jobType" = %s AND payload->>\'sourceId\' = %s ORDER BY "createdAt" DESC LIMIT 1',('SCAN_AND_INDEX_SOURCE',sid))
            if rows and rows[0][0]=='FAILED':raise AssertionError('Index job failed')
            return rows and rows[0][0]=='COMPLETED'
        wait_for(done)
    def upload(self,c,cid,name,text):
        raw=pdf(text);d=self.data(c,'POST',f'disputes/{cid}/sources/upload-intents',{'originalName':name,'mime':'application/pdf','byteCount':len(raw)})
        r=self.client.put(d['uploadHandle']['url'],content=raw,headers={'Content-Type':'application/pdf'});r.raise_for_status()
        self.data(c,'POST',f'disputes/{cid}/sources/{d["sourceId"]}/finalize',{'uploadId':d['uploadId']},d['sourceVersion'])
        self.index_done(d['sourceId']);return self.data(c,'GET',f'disputes/{cid}/sources/{d["sourceId"]}')
    def share(self,c,cid,s):
        r=self.data(c,'POST',f'disputes/{cid}/sources/{s["sourceId"]}/share',{'audience':'CASE_SHARED','consentIntent':'SHARE_SOURCE','paramsHash':s['shareParamsHash']},s['sourceVersion'])
        self.index_done(s['sourceId']);return r
    def tests(self):
        worker={'X-Worker-Service-Token':self.env['WORKER_TO_AI_SECRET']}
        callback={'X-AI-Callback-Token':self.env['AI_TO_EXPRESS_SECRET']}
        check('AI internal endpoints reject missing worker token',self.client.post(self.ai+'/internal/v1/case-runs',json={'runId':'r','purpose':'PERSONAL_ASSISTANT','expectedContextVersion':1}).status_code==401)
        check('Express context rejects missing callback token',self.client.get(self.api+'/internal/v1/case-runs/nope/context').status_code==401)
        customer,seller,admin=[self.login(x) for x in ['customer','seller','admin']]
        try:
            run=self.data(customer,'POST','agent/runs',{'purpose':'PERSONAL_ASSISTANT','prompt':'Show a Pocket Drive purchase option.'})
            personal=self.run_result(customer,run['runId'])
            check('Personal assistant completes through real Express outbox and checkpoint',personal['status']=='COMPLETED' and personal['result']['functionsExecuted']==['personal'])
            check('Fixture model and synthetic business data are labeled truthfully',personal['result']['modelMode']=='fixture' and personal['result']['businessDataMode']=='synthetic_fixture')
            self.stop(self.ai_process)
            retry_run=self.data(customer,'POST','agent/runs',{'purpose':'PERSONAL_ASSISTANT','prompt':'Show records.'})
            pending=wait_for(lambda:(lambda rows:rows if rows and rows[0][1]>0 and rows[0][0]=='PENDING' else None)(self.sql('SELECT state,"retryCount" FROM "OutboxJob" WHERE payload->>\'runId\' = %s',(retry_run['runId'],))))
            check('Offline AI job stays queued for retry instead of falsely completing',pending[0][0]=='PENDING')
            self.ai_process=self.start_ai();retried=self.run_result(customer,retry_run['runId'])
            check('Queued work recovers after AI returns',retried['status']=='COMPLETED')
            cid=self.data(customer,'POST','disputes',{'transactionId':'tx_vp_1028','category':'CONTESTED_CLAIM','statement':'Invoice lists 256GB; the received label appears different.'})['caseId']
            check('Customer cannot run seller preparation',customer.post('agent/runs',json={'purpose':'SELLER_PREPARATION','caseId':cid,'prompt':'help'}).status_code==404)
            buyer_file=self.upload(customer,cid,'invoice.pdf','Invoice Pocket Drive 256GB. USD 59.00. Serial not provided.')
            seller_file=self.upload(seller,cid,'packing-label.pdf','Packing label Pocket Drive 128GB. Serial not legible.')
            private_seller=self.upload(seller,cid,'seller-private.pdf','SELLER_PRIVATE_CANARY. Internal seller preparation only.')
            private_buyer=self.upload(customer,cid,'customer-private.pdf','CUSTOMER_PRIVATE_CANARY. Internal customer preparation only.')
            check('Uploaded real PDF bytes pass object storage and Qdrant ingestion',len(self.sql('SELECT id FROM "OutboxJob" WHERE "jobType"=%s AND state=%s',('SCAN_AND_INDEX_SOURCE','COMPLETED')))>=4)
            for client,purpose,forbidden,own in [(customer,'CUSTOMER_PREPARATION','SELLER_PRIVATE_CANARY','CUSTOMER_PRIVATE_CANARY'),(seller,'SELLER_PREPARATION','CUSTOMER_PRIVATE_CANARY','SELLER_PRIVATE_CANARY')]:
                run=self.data(client,'POST','agent/runs',{'purpose':purpose,'caseId':cid,'prompt':'Prepare my private position.'})
                result=self.run_result(client,run['runId'])
                ctx=self.client.get(self.api+f'/internal/v1/case-runs/{run["runId"]}/context',headers=callback).json()
                owner='usr_cust_01' if purpose=='CUSTOMER_PREPARATION' else 'usr_sell_01'
                check(purpose+' receives only own private sources',all(x['ownerId']==owner for x in ctx['allowedSources']))
                check(purpose+' cannot retrieve opponent private text',forbidden not in json.dumps(result) and own in json.dumps(result))
            self.share(customer,cid,buyer_file);self.share(seller,cid,seller_file)
            check('Sharing a new source version enqueues and completes reindexing',len(self.sql('SELECT id FROM "OutboxJob" WHERE "jobType"=%s AND state=%s',('SCAN_AND_INDEX_SOURCE','COMPLETED')))>=6)
            detail=self.data(customer,'GET',f'disputes/{cid}');version=detail['case']['caseVersion']
            asmt=self.data(customer,'POST',f'disputes/{cid}/assessments',{},version)
            result=self.run_result(customer,asmt['runId']);self.assessment_id=asmt['runId'];self.case_id=cid
            check('Shared assessment executes evidence and mediation functions',result['result']['functionsExecuted']==['evidence','mediation'])
            check('Conflicting evidence pauses for human review',result['status']=='NEEDS_INFO' and result['result']['requiresHumanApproval'])
            check('Shared result contains no private customer or seller canary','PRIVATE_CANARY' not in json.dumps(result))
            detail=self.data(customer,'GET',f'disputes/{cid}');before_control=detail['case']['controlVersion']
            ctx=self.client.get(self.api+f'/internal/v1/case-runs/{asmt["runId"]}/context',headers=callback).json()
            payload={k:ctx['signedManifest'][k] for k in ['inputVersion','accessRevision','manifestId','replayId','manifestHash','hmacSignature']};payload['resultPayload']=result['result']
            missing=dict(payload);missing.pop('hmacSignature')
            check('Missing manifest signature fails closed',self.client.post(self.api+f'/internal/v1/case-runs/{asmt["runId"]}/checkpoints',headers=callback,json=missing).status_code==403)
            duplicate=self.client.post(self.api+f'/internal/v1/case-runs/{asmt["runId"]}/checkpoints',headers=callback,json=payload)
            check('Duplicate checkpoint is idempotent',duplicate.status_code==200 and duplicate.json()['data'].get('duplicate') is True)
            check('Duplicate delivery does not increment controlVersion',self.data(customer,'GET',f'disputes/{cid}')['case']['controlVersion']==before_control)
            self.stop(self.ai_process);self.ai_process=self.start_ai()
            self.data(admin,'POST',f'admin/disputes/{cid}/assignments',{'conflictDeclarationAccepted':True,'reason':'Review the two conflicting capacity labels.'})
            step=self.data(admin,'POST','auth/mfa/challenges',{'purpose':'ADMIN_INTERVENTION','targetId':cid})
            step=self.data(admin,'POST','auth/mfa/verify',{'challengeId':step['challengeId'],'code':'123456'})
            d=self.data(admin,'POST',f'admin/disputes/{cid}/interventions',{'action':'ALLOW_VOLUNTARY_MEDIATION','reason':'Continue collecting evidence; no fault or refund is determined.','stepUpId':step['stepUpId']},before_control)
            resumed=wait_for(lambda:(lambda r:r if r['result'] and r['result'].get('reviewedDecisionId') else None)(self.data(customer,'GET','agent/runs/'+asmt['runId'])))
            check('Admin decision persists and resumes the durable graph after AI restart',resumed['result']['reviewedDecisionId']==d['decisionId'])
            check('Admin resume preserves uncertainty and does not decide a refund',not resumed['result']['requiresHumanApproval'] and resumed['result']['missingEvidence'] and resumed['result']['findings']==result['result']['findings'])
            detail=self.data(customer,'GET',f'disputes/{cid}');binding=detail['mediationBindings'];version=detail['case']['caseVersion']
            check('Backend supplies current authoritative UI bindings',bool(binding and binding['assessmentRunId']==asmt['runId']))
            bad=customer.post(f'disputes/{cid}/mediation-consents',json={'assessmentRunId':asmt['runId'],'paramsHash':'invented'},headers={'If-Match':str(version)})
            check('Invented mediation binding is rejected',bad.status_code==409)
            self.data(customer,'POST',f'disputes/{cid}/mediation-consents',{'assessmentRunId':asmt['runId'],'paramsHash':binding['mediationParamsHash'],'consentIntent':'CONTINUE_MEDIATION','decision':'APPROVED'},version)
            if self.args.browser:self.browser_test(cid)
            proposal=self.data(customer,'POST',f'disputes/{cid}/proposals',{'terms':'Voluntary partial settlement subject to both parties consent.','money':{'amountMinor':1000,'currency':'USD'},'sourceDigest':binding['sourceDigest'],'route':'PAYPAL_CAPTURE_REFUND'},version)
            check('Human can draft a proposal using the assessed source manifest',bool(proposal['proposalId']))
            check('AI and draft proposal do not invoke a financial operation',self.sql('SELECT count(*) FROM "ProviderOperation" WHERE "caseId"=%s',(cid,))[0][0]==0)
            seller_source=self.data(seller,'GET',f'disputes/{cid}/sources/{seller_file["sourceId"]}')
            self.data(seller,'POST',f'disputes/{cid}/sources/{seller_file["sourceId"]}/revoke',{'reason':'Withdraw permission.'},seller_source['sourceVersion'])
            wait_for(lambda:self.sql('SELECT state FROM "OutboxJob" WHERE "jobType"=%s AND payload->>\'sourceId\'=%s ORDER BY "createdAt" DESC LIMIT 1',('REVOKE_SOURCE',seller_file['sourceId']))[0][0]=='COMPLETED')
            detail=self.data(customer,'GET',f'disputes/{cid}')
            check('Revocation hides stale assessment and removes proposal bindings',detail['latestAssessment'] is None and detail['mediationBindings'] is None)
            check('Previously returned run is redacted after ACL revision change',self.data(customer,'GET','agent/runs/'+asmt['runId'])['result'] is None)
            # Inspect Qdrant directly to prove purge (not just result hiding).
            cols=self.client.get(self.q+'/collections').json()['result']['collections']
            count=0
            for col in cols:
                r=self.client.post(self.q+f'/collections/{col["name"]}/points/count',json={'filter':{'must':[{'key':'sourceId','match':{'value':seller_file['sourceId']}}]},'exact':True})
                count+=r.json()['result']['count']
            check('Revocation physically removes indexed source chunks',count==0)
            check('Revocation invalidates unexecuted proposal',self.sql('SELECT status FROM "Proposal" WHERE id=%s',(proposal['proposalId'],))[0][0]=='SUPERSEDED')
            # A source update racing with an old checkpoint must never publish that old result.
            check('Stale checkpoint cannot overwrite the new ACL snapshot',self.client.post(self.api+f'/internal/v1/case-runs/{asmt["runId"]}/checkpoints',headers=callback,json=payload).status_code==409)
        finally:customer.close();seller.close();admin.close()
    def browser_test(self,cid):
        self.start('web',['node','node_modules/next/dist/bin/next','dev','--hostname','127.0.0.1','--port',str(self.ports['web'])],WEB)
        base=f"http://127.0.0.1:{self.ports['web']}"
        wait_for(lambda:self.client.get(base+'/login').status_code==200,90)
        self.cli(['node',str(ROOT/'scripts/ibnu/ui-smoke.cjs'),base,cid,str(self.temp/'ui.png')],WEB)
        check('Browser in API mode enables backend-bound mediation and proposal controls',True)
    def close(self):
        for name,p in reversed(self.processes):self.stop(p)
        for log in self.logs:log.close()
        self.client.close()

def main():
    p=argparse.ArgumentParser();p.add_argument('--pglite-cli',required=True);p.add_argument('--qdrant-binary',required=True)
    p.add_argument('--browser',action='store_true');p.add_argument('--report',default=str(ROOT/'docs/ibnu/integration-results.json'));args=p.parse_args()
    stack=Stack(args);error=None
    try:stack.setup();stack.tests()
    except Exception as e:error=f'{type(e).__name__}: {e}';traceback.print_exc()
    finally:
        stack.close()
        report={'baseCommit':'95cfe69c0ab9ceb5a70d33cd524d95f0e9d3bfae','environment':{'database':'PGlite PostgreSQL wire protocol','objectStorage':'Moto S3 simulator','qdrant':'official v1.11.0 binary','api':'real Express + Prisma source','ai':'FastAPI fixture model + durable SQLite LangGraph','geminiLiveTested':False,'paypalCalled':False},'passed':len(CHECKS),'checks':CHECKS,'error':error}
        Path(args.report).parent.mkdir(parents=True,exist_ok=True);Path(args.report).write_text(json.dumps(report,indent=2)+'\n')
        print('Integration checks:',len(CHECKS),'error:',error,'local logs:',stack.temp,flush=True)
    return 1 if error else 0
if __name__=='__main__':raise SystemExit(main())

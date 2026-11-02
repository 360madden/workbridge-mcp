#!/usr/bin/env node
// Read-only detail for one known Workbridge job. Never starts a service or reruns a command.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/client';
import { connectService } from '../dist/local-service.js';

const jobId = process.argv[2];
if (typeof jobId !== 'string' || !/^[A-Za-z0-9_-]{1,100}$/.test(jobId)) {
  process.stdout.write(JSON.stringify({ok:false,error:'Invalid job ID'})+'\n');
  process.exitCode = 2;
} else {
  const repo = fileURLToPath(new URL('..', import.meta.url));
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12000);
  const client = new Client({name:'workbridge-desktop-job-detail',version:'1.0.0'});
  try {
    const {transport} = await connectService(path.join(repo,'.local'),{signal:controller.signal});
    await client.connect(transport,{signal:controller.signal,timeout:10000});
    const request = async (name,args) => {
      const response = await client.callTool({name,arguments:args},{signal:controller.signal,timeout:10000});
      if(response.isError) throw new Error('Workbridge query unsuccessful');
      return response.structuredContent ??
        JSON.parse(response.content?.find(x=>x.type==='text')?.text ?? '{}');
    };
    const [status, output] = await Promise.all([
      request('command_status',{jobId}),
      request('command_output',{jobId,tailChars:4000})
    ]);
    process.stdout.write(JSON.stringify({
      ok:true, jobId, status:status.status??null, command:status.command??null,
      exitCode:status.exitCode??null, startedAt:status.startedAt??null,
      endedAt:status.endedAt??null, outputTruncated:output.outputTruncated===true,
      log:typeof output.text==='string'?output.text.slice(-4000):'',
      sampledUtc:new Date().toISOString()
    })+'\n');
  } catch {
    process.stdout.write(JSON.stringify({ok:false,error:'Job details unavailable'})+'\n');
    process.exitCode=1;
  } finally {
    clearTimeout(timeout);
    await client.close().catch(()=>{});
  }
}

import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const directory = process.argv[2];
if (!directory) throw new Error('Usage: node scripts/backup-to-xml.mjs <private-backup-directory>');
function xml(value) {
  const text = value == null ? 'null' : String(value);
  // Fail instead of silently dropping data. Raw JSON remains the authoritative copy.
  if (/[^\u0009\u000A\u000D\u0020-\uD7FF\uE000-\uFFFD\u{10000}-\u{10FFFF}]/u.test(text)) throw new Error('A field contains XML-incompatible characters; preserve JSON and review conversion');
  return text.replaceAll('&','&amp;').replaceAll('"','&quot;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('\r','&#13;').replaceAll('\n','&#10;').replaceAll('\t','&#9;');
}
function element(tag, values) { return '  <'+tag+' '+Object.entries(values).map(([key,value])=>key+'="'+xml(value)+'"').join(' ')+' />'; }
const sms = JSON.parse(readFileSync(join(directory,'sms.json'),'utf8')).rows;
const calls = JSON.parse(readFileSync(join(directory,'calls.json'),'utf8')).rows;
const messages = sms.map((row)=>element('sms',{
  protocol:row.protocol ?? 0,address:row.address,date:row.date,type:row.type,
  subject:row.subject,body:row.body,toa:null,sc_toa:null,service_center:row.service_center,
  read:row.read ?? 0,status:row.status ?? -1,locked:row.locked ?? 0,date_sent:row.date_sent ?? 0,
  ...(row.sub_id == null ? {} : {sub_id:row.sub_id}),
}));
const records = calls.map((row)=>element('call',{
  number:row.number,duration:row.duration,date:row.date,type:row.type,
  presentation:row.presentation ?? row.number_presentation ?? 1,
  subscription_id:row.subscription_id ?? row.phone_account_id,
  contact_name:row.name ?? '(Unknown)',
}));
writeFileSync(join(directory,'sms.xml'),'<?xml version="1.0" encoding="UTF-8"?>\n<smses count="'+sms.length+'">\n'+messages.join('\n')+'\n</smses>\n',{flag:'wx',mode:0o600});
writeFileSync(join(directory,'calls.xml'),'<?xml version="1.0" encoding="UTF-8"?>\n<calls count="'+calls.length+'">\n'+records.join('\n')+'\n</calls>\n',{flag:'wx',mode:0o600});
console.log(JSON.stringify({smsXmlCount:sms.length,callsXmlCount:calls.length}));

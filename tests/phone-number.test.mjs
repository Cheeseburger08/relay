import {test} from 'node:test';
import assert from 'node:assert/strict';
import {isPhoneNumber} from '../server/phone-number.mjs';
test('local, short and international numbers do not require country conversion',()=>{
 for(const number of ['02025550101','12345','+12025550101','020 2555-0101']) {
  assert.equal(isPhoneNumber(number),true,number);
 }
 for(const number of ['',null,12345,'+','abc','12\n34','tel:123','1'.repeat(41)])assert.equal(isPhoneNumber(number),false);
});

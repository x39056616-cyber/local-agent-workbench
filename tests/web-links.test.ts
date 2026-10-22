import {test} from 'node:test';
import assert from 'node:assert/strict';
import {trimUrlToken} from '../web/links.ts';
test('网页裸网址保留参数与括号并去除末尾分隔符',()=>{
 assert.deepEqual(trimUrlToken('https://example.com/a?x=1&y=2;'),{url:'https://example.com/a?x=1&y=2',trailing:';'});
 assert.equal(trimUrlToken('https://example.com/a_(b)').url,'https://example.com/a_(b)');
 assert.deepEqual(trimUrlToken('https://example.com/a).'),{url:'https://example.com/a',trailing:').'});
 assert.equal(trimUrlToken('https://example.com/a?q=%E4%B8%AD').url,'https://example.com/a?q=%E4%B8%AD');
});

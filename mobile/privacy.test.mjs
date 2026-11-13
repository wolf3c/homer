import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

test('iOS declares why a WebView image may be saved to Photos',()=>{
 const {expo}=JSON.parse(readFileSync(new URL('./app.json',import.meta.url),'utf8'));
 assert.ok(expo.ios.infoPlist?.NSPhotoLibraryAddUsageDescription?.trim(),'saving an image must have an add-only Photos purpose string');
});

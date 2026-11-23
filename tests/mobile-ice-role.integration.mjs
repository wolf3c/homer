import assert from 'node:assert/strict';
import {createHmac, randomBytes} from 'node:crypto';
import {createSocket} from 'node:dgram';
import {once} from 'node:events';
import {createRequire} from 'node:module';
import {crc32} from 'node:zlib';

const require = createRequire(import.meta.url);
const rtc = require(process.argv[2] ?? 'node-datachannel');
const peer = new rtc.PeerConnection('loopback-ice-role-check', {iceServers: [], enableIceTcp: false});
const socket = createSocket('udp4');

function attribute(type, value) {
  const bytes = Buffer.alloc(4 + Math.ceil(value.length / 4) * 4);
  bytes.writeUInt16BE(type);
  bytes.writeUInt16BE(value.length, 2);
  value.copy(bytes, 4);
  return bytes;
}

function bindingRequest(transaction, username, password) {
  const header = Buffer.alloc(20);
  header.writeUInt16BE(0x0001);
  header.writeUInt32BE(0x2112a442, 4);
  transaction.copy(header, 8);
  const attributes = Buffer.concat([
    attribute(0x0006, Buffer.from(username)),
    attribute(0x0024, Buffer.from([0x6e, 0x7f, 0x1e, 0xff])),
    attribute(0x8029, Buffer.alloc(8)),
  ]);
  header.writeUInt16BE(attributes.length + 24, 2);
  const integrity = createHmac('sha1', password).update(header).update(attributes).digest();
  header.writeUInt16BE(attributes.length + 32, 2);
  const frame = Buffer.concat([header, attributes, attribute(0x0008, integrity)]);
  const fingerprint = Buffer.alloc(4);
  fingerprint.writeUInt32BE((crc32(frame) ^ 0x5354554e) >>> 0);
  return Buffer.concat([frame, attribute(0x8028, fingerprint)]);
}

try {
  const candidate = new Promise(resolve => {
    peer.onLocalCandidate((line, mid) => {
      const match = /\bUDP \d+ (\d+\.\d+\.\d+\.\d+) (\d+) typ host\b/i.exec(line);
      if (match) resolve({address: match[1], port: Number(match[2]), mid});
    });
  });
  peer.createDataChannel('synthetic');
  const {address, port, mid} = await candidate;
  socket.bind(0, address);
  await once(socket, 'listening');
  const {sdp} = peer.localDescription();
  const localUfrag = /^a=ice-ufrag:([^\s]+)/m.exec(sdp)[1];
  const localPassword = /^a=ice-pwd:([^\s]+)/m.exec(sdp)[1];
  const answer = sdp.replace(/^a=ice-ufrag:[^\r\n]+/m, 'a=ice-ufrag:synthetic')
    .replace(/^a=ice-pwd:[^\r\n]+/m, 'a=ice-pwd:abcdefghijklmnopqrstuvwxy')
    .replace(/^a=setup:actpass/m, 'a=setup:active')
    .replace(/^a=(?:candidate:.*|end-of-candidates)\r?\n/gm, '');
  peer.setRemoteDescription(answer, 'answer');
  peer.addRemoteCandidate(`candidate:1 1 UDP 2122260223 ${address} ${socket.address().port} typ host`, mid);
  const transaction = randomBytes(12);
  const response = new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(Error('local STUN response timed out')), 3000);
    socket.on('message', message => {
      if (!message.subarray(8, 20).equals(transaction)) return;
      clearTimeout(timeout);
      resolve(message.readUInt16BE());
    });
  });
  socket.send(bindingRequest(transaction, `${localUfrag}:synthetic`, localPassword), port, address);
  assert.equal(await response, 0x0101, 'an authenticated ICE-CONTROLLED request with a zero tie-breaker must receive a Binding Success');
  console.log('ICE-CONTROLLED zero tie-breaker accepted');
} finally {
  socket.close();
  peer.close();
  rtc.cleanup();
}

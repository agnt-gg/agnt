import { describe, it, expect } from 'vitest';
import { publicIPv4, resolvePublicDestination } from './toolNetwork.js';
describe('tool egress boundary',()=>{
 it('refuses private, loopback, link-local, metadata, carrier-grade NAT and reserved addresses',()=>{
  for(const value of ['0.0.0.0','10.1.2.3','127.0.0.1','169.254.169.254','172.16.0.1','172.31.255.255','192.168.1.1','100.64.0.1','198.18.0.1','224.0.0.1','255.255.255.255','::1','::ffff:127.0.0.1'])expect(publicIPv4(value),value).toBe(false);
  for(const value of ['1.1.1.1','8.8.8.8'])expect(publicIPv4(value)).toBe(true);
 });
 it('rejects a hostname if any of its returned addresses is private',async()=>{
  await expect(resolvePublicDestination('example.test',async()=>[{address:'1.1.1.1'},{address:'127.0.0.1'}])).rejects.toThrow();
 });
 it('pins one checked address rather than resolving again when connecting',async()=>{
  let calls=0;const ip=await resolvePublicDestination('example.test',async()=>{calls++;return[{address:'1.1.1.1'}];});expect(calls).toBe(1);expect(ip).toBe('1.1.1.1');
 });
});

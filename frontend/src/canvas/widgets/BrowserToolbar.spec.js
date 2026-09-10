import { describe, it, expect } from 'vitest';
import { mount } from '@vue/test-utils';
import BrowserToolbar from './BrowserToolbar.vue';

// Pin the actual internal page contract; near-matches must remain visible.
const welcomeHtml = '<!doctype html><title>AGNT Browser</title>'
  + '<body style="margin:0;height:100vh;display:grid;place-items:center;'
  + 'background:#0d0d16;color:#8b8ba3;font:15px system-ui">'
  + '<div style="text-align:center"><div style="font-size:34px;margin-bottom:12px">🌐</div>'
  + 'AGNT Browser — ready.<br>Ask Annie to browse something.</div>';
const welcomeUrl = 'data:text/html;charset=utf-8,' + encodeURIComponent(welcomeHtml);

describe('Given the internal AGNT welcome page', () => {
  it('When displayed, Then it has an empty address with a readable placeholder and Go does nothing', async () => {
    const w = mount(BrowserToolbar, {props:{url:welcomeUrl}});
    expect(w.get('input').element.value).toBe('');
    expect(w.get('input').attributes('placeholder')).toBe('AGNT Browser — ready');
    expect(w.get('.go-button').attributes('disabled')).toBeDefined();
    await w.get('form').trigger('submit');
    expect(w.emitted('navigate')).toBeUndefined();
    w.unmount();
  });
  it('When cancelled or blurred empty, Then the encoded page does not reappear', async () => {
    const w = mount(BrowserToolbar, {props:{url:welcomeUrl}});
    await w.get('input').setValue('example.com');
    await w.get('input').trigger('keydown', {key:'Escape'});
    expect(w.get('input').element.value).toBe('');
    await w.get('input').trigger('blur');
    expect(w.get('input').element.value).toBe('');
    await w.setProps({url:'https://example.com/path'});
    expect(w.get('input').element.value).toBe('https://example.com/path');
    await w.setProps({url:welcomeUrl});
    expect(w.get('input').element.value).toBe('');
    w.unmount();
  });
  it('When a data page only resembles the welcome page, Then its address is not disguised', () => {
    const url='data:text/html;charset=utf-8,'+encodeURIComponent(welcomeHtml+'<script>1</script>');
    const w=mount(BrowserToolbar,{props:{url}});
    expect(w.get('input').element.value).toBe(url);
    w.unmount();
  });
});

describe('Given honest address handling', () => {
  it.each(['http://example.com', welcomeUrl, 'about:blank'])('When not HTTPS, Then no lock is shown: %s', url => {
    const w=mount(BrowserToolbar,{props:{url}});
    expect(w.find('.fa-lock').exists()).toBe(false);
    w.unmount();
  });
  it('When the current page is HTTPS, Then its lock stays tied to the page rather than the draft', async () => {
    const w=mount(BrowserToolbar,{props:{url:'https://example.com'}});
    expect(w.find('.fa-lock').exists()).toBe(true);
    await w.get('input').setValue('http://example.net');
    expect(w.find('.fa-lock').exists()).toBe(true);
    w.unmount();
  });
  it.each(['data:text/html,hello', 'about:blank', 'javascript:alert(1)', 'file:///tmp/test', 'ftp://example.com'])('When Go is submitted for a non-web scheme, Then no navigation is emitted: %s', async url => {
    const w=mount(BrowserToolbar,{props:{url}});
    await w.get('form').trigger('submit');
    expect(w.emitted('navigate')).toBeUndefined();
    w.unmount();
  });
  it('When a bare host includes a port, Then it is still normalized to HTTPS', async () => {
    const w=mount(BrowserToolbar,{props:{url:'about:blank'}});
    await w.get('input').setValue('localhost:3000/path');
    await w.get('form').trigger('submit');
    expect(w.emitted('navigate')).toEqual([['https://localhost:3000/path']]);
    w.unmount();
  });
});

describe('BrowserToolbar', () => {
  it('Given focused address text, When the page changes then focus leaves, Then the actual current URL is shown',async()=>{
    const w=mount(BrowserToolbar,{props:{url:'https://old.example'}});
    await w.get('input').trigger('focus');await w.setProps({url:'https://new.example'});
    await w.get('input').trigger('blur');expect(w.get('input').element.value).toBe('https://new.example');w.unmount();
  });
  it('Given busy navigation, When form submit is triggered, Then no duplicate navigation is emitted',async()=>{
    const w=mount(BrowserToolbar,{props:{url:'https://example.com',busy:true}});
    await w.get('form').trigger('submit');expect(w.emitted('navigate')).toBeUndefined();w.unmount();
  });

  it('turns a hostname into an HTTPS navigation', async () => {
    const wrapper = mount(BrowserToolbar, { props: { url: 'about:blank' } });
    const input = wrapper.get('input[aria-label="Address"]');

    await input.setValue('x.com');
    await wrapper.get('form').trigger('submit');

    expect(wrapper.emitted('navigate')).toEqual([['https://x.com']]);
  });

  it.each([
    'http://localhost:3000/path',
    'https://agnt.gg/security',
  ])('keeps an explicit web address intact: %s', async (url) => {
    const wrapper = mount(BrowserToolbar, { props: { url: 'about:blank' } });
    await wrapper.get('input[aria-label="Address"]').setValue(url);
    await wrapper.get('form').trigger('submit');

    expect(wrapper.emitted('navigate')).toEqual([[url]]);
  });

  it('exposes ordinary browser controls with honest disabled state', () => {
    const wrapper = mount(BrowserToolbar, {
      props: { url: 'https://agnt.gg', canGoBack: true, canGoForward: false },
    });

    expect(wrapper.get('button[aria-label="Back"]').attributes('disabled')).toBeUndefined();
    expect(wrapper.get('button[aria-label="Forward"]').attributes('disabled')).toBeDefined();
    expect(wrapper.get('button[aria-label="Reload"]').attributes('disabled')).toBeUndefined();
  });
});

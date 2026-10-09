import { test, expect } from '@playwright/test';
import { createServer } from '../../frontend/node_modules/vite/dist/node/index.js';
import vue from '../../frontend/node_modules/@vitejs/plugin-vue/dist/index.mjs';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// Render the production card and theme CSS. Only the stream transport is a
// stand-in: no backend, credentials, viewer lease or external browser needed.
const frontend = fileURLToPath(new URL('../../frontend/', import.meta.url));
let server;
let origin;
const fixture = `
import { createApp, h, ref, KeepAlive } from 'vue';
import Card from '/src/views/Terminal/CenterPanel/screens/Chat/components/BrowserLiveCard.vue';
import '/src/styles/base/_variables.css';
import '/src/styles/themes/_dark.css';
import '/src/styles/themes/_light.css';
import '/src/styles/themes/_aliases.css';
const visible = ref(true);
const app = createApp({ setup() { return () => h(KeepAlive, null, [visible.value
  ? h(Card, {cardKey:'fullscreen-regression', conversationId:'fixture', live:true})
  : h('div', 'Other screen')]); }});
app.directive('tooltip', {});
app.mount('#transcript');
window.leaveChat = () => { visible.value = false; };
`;
// Since 548273ece the card stays hidden until its stream reports real frames
// (@showing), so the stand-in reports them as soon as it mounts.
const stream = `import { defineComponent, h, onMounted } from 'vue';
export const lazyComponent = () => defineComponent({
 props: ['highQuality'],
 emits: ['showing', 'page'],
 setup(_, { emit }) { window.streamMounts = (window.streamMounts || 0) + 1; onMounted(() => emit('showing', true)); return () => h('canvas', {tabindex:0, class:'stream-stub', onKeydown:e=>e.stopPropagation()}); }
});`;

// Use the owning shell's REAL rules, not a reconstruction of their sizing.
const shellStyle = readFileSync(new URL('../../frontend/src/canvas/CanvasScreen.vue', import.meta.url), 'utf8').match(/<style scoped>([\s\S]*?)<\/style>/)[1];
const html = `<!doctype html><html><head><style>
${shellStyle}
html,body,#shell {margin:0;width:100%;height:100%;} * {box-sizing:border-box}
body {font-family:monospace}
.cv-sidebar {width:123px;flex:none}
#underlay {position:absolute;inset:0;background:#ff00ff;color:#00ff00;font:28px monospace}
#transcript {position:relative;padding:90px 30px}
.stream-stub {width:100%;height:100%;background:transparent}
</style></head><body class="dark"><div id="shell" class="cv-root">
<div class="cv-toolbar"><button id="chrome">App toolbar</button></div>
<div class="cv-main-area"><nav class="cv-sidebar">Navigation</nav><main class="cv-dashboard">
<div class="cv-personal-content" data-fullscreen-host><div id="underlay">SAVED CHATS — MUST NOT BLEED THROUGH</div><div id="transcript"></div></div>
</main></div></div><script type="module" src="/@id/fullscreen-fixture"></script></body></html>`;

test.beforeAll(async () => {
  server = await createServer({root:frontend, configFile:false, server:{host:'127.0.0.1',port:0}, optimizeDeps:{noDiscovery:true,include:['vue']}, cacheDir:'node_modules/.vite-browser-fullscreen-test',
    resolve:{alias:{'@':`${frontend}src`}},
    plugins:[{name:'fullscreen-regression-fixture',enforce:'pre',
      resolveId(id, importer) {
        if (id === 'fullscreen-fixture') return '\0fullscreen-fixture';
        if (id.endsWith('chunkRecovery.js') && importer?.includes('BrowserLiveCard.vue')) return '\0stream-stub';
      },
      load(id) { if(id==='\0fullscreen-fixture') return fixture; if(id==='\0stream-stub') return stream; }
    },vue()]});
  await server.listen();
  origin = `http://127.0.0.1:${server.httpServer.address().port}`;
});
test.afterAll(async () => { await server?.close(); });

for (const theme of ['dark','light']) {
  test(`fullscreen is opaque and bounded in ${theme}, with a transparent theme and wallpaper @ci`, async ({page}, info) => {
    await page.setViewportSize({width:1280,height:800});
    await page.route(`${origin}/`, r => r.fulfill({contentType:'text/html',body:html}));
    await page.goto(origin);
    await page.locator('.live-fullscreen').waitFor();
    await page.evaluate(theme => {document.body.className = theme === 'light' ? '' : 'dark';}, theme);
    await page.getByRole('button',{name:'Fullscreen',exact:true}).click();
    const card = page.locator('.browser-live-card.is-fullscreen');
    await expect(card).toBeVisible();
    for (const customBackground of [false,true]) {
      await page.evaluate(custom => {
        document.body.classList.toggle('custom-bg',custom);
        // Wallpaper opacity must never turn the foreground panel into a tint.
        document.body.style.setProperty('--color-background','rgba(16,16,31,0.2)');
      },customBackground);
      const result = await card.evaluate(el => {
        const r=el.getBoundingClientRect(), host=el.parentElement.getBoundingClientRect();
        const button=el.querySelector('.live-fullscreen'), b=button.getBoundingClientRect();
        return {background:getComputedStyle(el).backgroundColor, parent:el.parentElement.hasAttribute('data-fullscreen-host'),
          rect:r.toJSON(),host:host.toJSON(),toolbar:document.querySelector('.cv-toolbar').getBoundingClientRect().toJSON(),
          exitReachable:button.contains(document.elementFromPoint(b.x+b.width/2,b.y+b.height/2))};
      });
      await info.attach(`geometry-${customBackground}`,{body:JSON.stringify(result),contentType:'application/json'});
      // Computed alpha, not a source-text assertion: --color-darkest used to
      // resolve to rgba(0,0,0,.1) despite a seemingly opaque fallback literal.
      expect(result.background).toMatch(/^rgb\(/);
      expect(result.parent).toBe(true);
      expect(result.rect.top).toBeGreaterThanOrEqual(result.toolbar.bottom);
      for (const edge of ['top','bottom','left','right']) expect(result.rect[edge]).toBe(result.host[edge]);
      expect(result.exitReachable).toBe(true);
      // Pixel-level occlusion: repaint EVERYTHING under the card. Its pixels
      // must not change. This catches translucent fills with otherwise correct z-order.
      const before = await card.screenshot();
      await page.locator('#underlay').evaluate(e=>{e.style.background='#00ffff';e.style.color='#ff0000';e.textContent='DIFFERENT UNDERLYING UI';});
      expect(await card.screenshot()).toEqual(before);
    }
    const mounts = await page.evaluate(()=>window.streamMounts);
    await page.setViewportSize({width:960,height:700});
    await page.locator('.stream-stub').focus();
    await page.keyboard.press('Escape');
    await expect(card).toHaveCount(0);
    await page.getByRole('button',{name:'Fullscreen',exact:true}).click();
    await page.getByRole('button',{name:'Exit fullscreen',exact:true}).click();
    expect(await page.evaluate(()=>window.streamMounts)).toBe(mounts);
    await page.getByRole('button',{name:'Fullscreen',exact:true}).click();
    await page.evaluate(()=>window.leaveChat());
    await expect(card).toHaveCount(0);
  });
}

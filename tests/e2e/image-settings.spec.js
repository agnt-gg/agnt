import {test,expect,gotoApp} from './fixtures/appFixture.js';
test('Independent image provider and API policy save without changing text model @ci',async({appPage})=>{
 let settings={schemaVersion:1,revision:0,selectedConnectionId:null,options:{},authorizations:{}};const writes=[];
 await appPage.route('**/api/users/image-settings',async route=>{if(route.request().method()==='PUT'){const body=route.request().postDataJSON();writes.push(body);settings={...settings,revision:settings.revision+1,selectedConnectionId:body.selectedConnectionId,options:{openai:body.options.value}};return route.fulfill({json:{success:true,settings}});}return route.fulfill({json:{settings,connections:[{id:'openai',provider:'openai',label:'OpenAI Images API',connected:true,models:['gpt-image-2'],requiresConsent:false,billing:'API usage — billed separately'}]}});});
 await gotoApp(appPage,'/settings');
 await appPage.getByText('Images',{exact:true}).first().click();
 const section=appPage.locator('[data-section="images"]');
 await expect(section.getByRole('heading',{name:'Image generation',exact:true})).toBeVisible();
 await section.locator('.custom-select').first().click();
 await appPage.getByText('OpenAI Images API',{exact:true}).last().click();
 await section.locator('.custom-select').nth(1).click();
 await appPage.getByText('Latest · Fast',{exact:true}).last().click();
 await section.getByRole('button',{name:'Save image settings'}).click();
 await expect(section.getByRole('status')).toHaveText('Saved');
 expect(writes[0]).toEqual({expectedRevision:0,selectedConnectionId:'openai',options:{connectionId:'openai',value:{model:'latest-fast'}}});
 await gotoApp(appPage,'/chat');
 await expect(appPage.getByRole('button',{name:'Images: OpenAI Images API'}).first()).toBeVisible();
 expect(writes).toHaveLength(1);
});

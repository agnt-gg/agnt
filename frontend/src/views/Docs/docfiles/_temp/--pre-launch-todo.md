# Prioritized Pre-Launch Todo List

## Todo by Feature:

### Global

✅ Move all localhosts on frontend to central port config & ai config to config file, along w/ env?? can it all be in one file/place??
✅ Implement Popup Tutorial memory in localstorage to remember finished tours
✅ Check for unused npm packages and remove (a ton in backend due to testing, prob some in frontend too)
✅ Make adding new models easier!!! Can we move this to tt.config also???

✅ Setup TaskTitan API
⬜ Buldle App w/ Electron

✅ Website waitlist post to TaskTitan API
✅ Local login posts to TaskTitan API
✅ DECOUPLE LOCAL LOGIN COMPLETELY
✅ Workflow sharing to TaskTitan API
✅ Tool sharing to TaskTitan API
✅ Output sharing to TaskTitan API
✅ Switch Google Login callback to TaskTitan API & Log users
⬜ Switch tool & workflow generation to env setting instead of hardcoded anthropic
✅ Move DB file to root backend directory so users can update w/o overwriting DB??
✅ Move tt.config file to root frontend directory so users can update w/o messing up config??
⬜ Final sweep for commented out old code not needed
⬜ Move config & test config files into own directory

### Workflow View:

⬜ Create
--- ✅ Tested Manually
--- ⬜ Test Implemented
⬜ Read
--- ✅ Tested Manually
--- ⬜ Test Implemented
⬜ Update
--- ✅ Tested Manually
--- ⬜ Test Implemented
⬜ Delete
--- ✅ Tested Manually
--- ⬜ Test Implemented
⬜ Generate
--- ✅ Tested Manually
--- ⬜ Test Implemented
⬜ Run Workflow
--- ✅ Tested Manually
--- ⬜ Test Implemented
⬜ Stop Workflow
--- ✅ Tested Manually
--- ⬜ Test Implemented
⬜ Monitor Workflow Status
--- ✅ Tested Manually
--- ⬜ Test Implemented
⬜ Share **(can this happen before cloud?? post to task titan api to share??)
--- ⬜ Tested Manually
--- ⬜ Test Implemented
⬜ Import **
--- ⬜ Tested Manually
--- ⬜ Test Implemented

#### Workflow View Bugs / Issues:

⬜ Custom Tools - Providers / Models should match config / Tool Forge
⬜ Custom Tools - Custom fields in the Panel Tab should match the custom field types in the custom tool.
⬜ Saving workflow should stop and restart workflow at server

#### Workflow Tool Testing (Test Manually & Implement Vue Test)

**Triggers:**
⬜ Email Receiver
--- ⬜ Tested Manually
--- ⬜ Test Implemented
⬜ Slack Receive
--- ✅ Tested Manually
--- ⬜ Test Implemented
⬜ Discord Receiver
--- ✅ Tested Manually
--- ⬜ Test Implemented
⬜ Sheets New Row
--- ⬜ Tested Manually
--- ⬜ Test Implemented
⬜ Incoming Webhook
--- ⬜ Tested Manually
--- ⬜ Test Implemented
⬜ Timer Trigger
--- ⬜ Tested Manually
--- ⬜ Test Implemented

**Actions**
⬜ Send Email
--- ⬜ Tested Manually
--- ⬜ Test Implemented
⬜ Send Slack Message
--- ✅ Tested Manually
--- ⬜ Test Implemented
⬜ Send Discord Message
--- ✅ Tested Manually
--- ⬜ Test Implemented
⬜ LLM AI Call
--- ✅ Tested Manually
--- ⬜ Test Implemented
⬜ Sheets Operation
--- ✅ Tested Manually
--- ⬜ Test Implemented
⬜ Outgoing Webhook (custom api request)
--- ⬜ Tested Manually
--- ⬜ Test Implemented
⬜ Web Search
--- ⬜ Tested Manually
--- ⬜ Test Implemented

**Controls**

⬜ Delay
--- ⬜ Tested Manually
--- ⬜ Test Implemented
⬜ Teleport (parallel executor, need to rename)
--- ⬜ Tested Manually
--- ⬜ Test Implemented

**Utilities**

⬜ Text Label
--- ✅ Tested Manually
--- ⬜ Test Implemented
⬜ Data Transformer
--- ⬜ Tested Manually
--- ⬜ Test Implemented
⬜ Execute JavaScript
--- ✅ Tested Manually
--- ⬜ Test Implemented
⬜ Execute Python
--- ✅ Tested Manually
--- ⬜ Test Implemented
**Custom**

⬜ Random Number Generator
--- ⬜ Tested Manually
--- ⬜ Test Implemented
⬜ User Custom Tools
--- ⬜ Tested Manually
--- ⬜ Test Implemented

### ToolForge View:

⬜ Create
--- ⬜ Tested Manually (show alert confirmation similar to workflow)
--- ⬜ Test Implemented
⬜ Read
--- ⬜ Tested Manually
--- ⬜ Test Implemented
⬜ Update
--- ⬜ Tested Manually (show alert confirmation similar to workflow)
--- ⬜ Test Implemented
⬜ Delete
--- ⬜ Tested Manually (show alert confirmation similar to workflow)
--- ⬜ Test Implemented
⬜ Generate
--- ⬜ Tested Manually (show popup generation modal & alert confirmation similar to workflow)
--- ⬜ Test Implemented
⬜ Share **(can this happen before cloud?? post to task titan api to share??)
--- ⬜ Tested Manually
--- ⬜ Test Implemented
⬜ Import **
--- ⬜ Tested Manually
--- ⬜ Test Implemented
⬜ Run Tool
--- ⬜ Tested Manually
--- ⬜ Test Implemented

#### Content Actions

⬜ Save Content
--- ⬜ Tested Manually
--- ⬜ Test Implemented
⬜ Copy Content
--- ⬜ Tested Manually
--- ⬜ Test Implemented
⬜ Save to PDF
--- ⬜ Tested Manually
--- ⬜ Test Implemented
⬜ Share Content
--- ⬜ Tested Manually
--- ⬜ Test Implemented
⬜ Import Content
--- ⬜ Tested Manually
--- ⬜ Test Implemented
⬜ Clear Content
--- ⬜ Tested Manually
--- ⬜ Test Implemented
⬜ Delete Content
--- ⬜ Tested Manually
--- ⬜ Test Implemented

#### ToolForge View Bugs / Issues:

⬜ Saving a new tool should show that tools name in the select dropdown and it should be the current selected tool
⬜ Importing content doesnt append it to the stream messages (the AI has no context of it!)

### Chat View:

✅ Create
✅ Read
✅ Update
✅ Delete
✅ Generate
✅ Share **
✅ Import **

#### Chat View Bugs / Issues:

⬜ Custom Tools

### Dashboard View

✅ Workflow List
✅ Workflow Stats
✅ Tool List
✅ Tool Stats
✅ Output List

#### Dashboard View Bugs / Issues:

⬜ Custom Tools

### Settings View

✅ Login w/ Google (required?? def required for sharing tools/workflows)

#### Settings View Bugs / Issues:

⬜ Custom Tools

## High Priority (Critical for Launch)

1. ✅ Cleanup stream api file & migrate to routes/controller
2. ✅ Cleanup tasktitan backend stream files and rename
3. ⬜ Fix activeworkflow ID bug (when two windows are open it overrides when saved, also i think any edits resave if not stopped first)
4. ✅ Finish CRUD system to ensure tools stay synced with DB, not localstorage
5. ✅ Change saved tool outputs to DB, not localstorage
6. ✅ Implement workflow sharing API on tasktitan.ai
7. ✅ Implement tool sharing API on tasktitan.ai
8. ⬜ Update WorkflowGenerator prompt to remove all specific testing info
9. ✅ Change email/webhook within panel to show actual workflow email/webhook set in system
10. ✅ Change slow/fast models to provider/model pattern (for both Tool and Chat systems)
11. ✅ Integrate Custom Tools into System (add user-created tools from ToolLibrary to sidebar)
12. ⬜ Remove all commented out & not needed code
13. ⬜ Remove all not needed console logs
14. ✅ Search for all hard coded URLs (localhost, etc)
15. ✅ Clean up app.js, frontend, and backend files (CreateView should be toolforge, '@/base/js/stream' moved, etc)
16. ⬜ Saving workflow should update it in the database and restart it

## Medium Priority (Important for User Experience)

16. ✅ Store/read popup tutorial system state in localstorage
17. ✅ Basic responsive scaling w/ common breakpoints
18. ⬜ Firefox optimizations
19. ⬜ Safari optimizations
20. ⬜ Modify user creation to create a default demo workflow for each user
21. ⬜ Have links to the above starter templates on the dashboard
22. ✅ Create My Stats Component (develop component to display user stats on Dashboard)
23. ✅ Implement My Saved Outputs into SQL

## Lower Priority (Can be addressed post-launch)

24. ⬜ Add Workflow AI Chat Modification feature
25. ✅ Setup tasktitan.ai email addresses
26. ✅ Setup waitlist website
27. ✅ Setup Github repo

## Testing (Ongoing)

28. ⬜ Implement test coverage for:
    ⬜ Core (login, logout)
    ⬜ Workflows (create, read, update, delete, share, run, stop, status)
    ⬜ Tools (create, read, update, delete, share, generate [test], use [in workflow])

## Completed

✅ Chromium optimizations
✅ Develop AI Based Tool Forge Starter

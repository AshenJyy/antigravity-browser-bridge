# Browser Bridge protocol v2

All control stays on `127.0.0.1:9224` (configurable through `BROWSER_BRIDGE_PORT`). HTTP requires `Authorization: Bearer <token>` except a minimal `GET /health`. User state defaults to the platform's user-local BrowserBridge directory; `BROWSER_BRIDGE_DATA_DIR` overrides it. Persist an installation token in `token` using exclusive creation. Never log the token. HTTP requests with an Origin header are rejected; the extension uses WebSocket.

## Host API

`POST /v1/call` receives `{sessionId, client, action, args}`. Client is `dsh`, `antigravity`, or `cli`. A host creates its own opaque sessionId; it is not a model-supplied argument. Responses are `{ok:true,result}` or `{ok:false,error:{code,message,details?}}`. `GET /v1/status` is authenticated. Do not automatically replay mutating calls after timeout or reconnect.

Public actions: `status`, `tabs`, `open`, `claim`, `release`, `session_close`, `navigate`, `back`, `forward`, `reload`, `close`, `snapshot`, `content`, `screenshot`, `click`, `hover`, `type`, `press`, `scroll`, `select`, `wait`, `upload`, `download`, `downloads`, `dialog`, `evaluate`.

`args.tab` is always an opaque `<instanceId>:<numericTabId>` handle returned by `tabs` or `open`. No implicit active-tab fallback. `open` accepts `{url,instanceId?,active?,label?}`; instanceId is required if several browser instances are online. `tabs` accepts `{instanceId?}` and returns metadata, including ownership. `claim` explicitly acquires a free existing tab; never steals another session's tab. All other tab operations require this session's ownership. `release` detaches and ungroups without closing. `session_close` releases all owned tabs; it never closes them implicitly. Sessions/ownership are invalidated on daemon restart; extension reconnect to a live daemon retains ownership only for the same persistent instanceId.

Common tab args: `{tab, ...}`. Targets use `{ref}` from a snapshot, or `{selector,frameId?}`, or `{x,y}` for click/hover. Element refs are scoped to their tab, document and snapshot and fail explicitly when stale. `type` adds `{text,clear?}`; `press` takes `{key,modifiers?}` (modifiers: Alt,Control,Meta,Shift); `scroll` uses `{deltaX?,deltaY?,x?,y?}`; `select` uses `{values:string[]}`; `wait` uses `{selector?,ref?,text?,state?:'visible'|'hidden'|'attached',timeoutMs?}`; `upload` uses `{selector?,ref?,frameId?,files:string[]}` with absolute existing local files; `screenshot` uses `{fullPage?}` and returns `{mimeType:'image/png',data:<base64>}`; `snapshot` uses `{limit?,frameId?}`; `content` uses `{maxChars?,frameId?}`; `evaluate` uses `{expression,frameId?}` and is an explicit advanced escape hatch.

`download` uses owned `{tab,url,filename?}` (relative download filename only); `downloads` accepts `{tab}` and only returns this session/tab's initiated downloads. `dialog` uses `{tab,accept,promptText?}`. `navigate` adds `{url}`. No arbitrary CDP tool is exposed in v2 because it would bypass ownership through Target/Browser domains.

## Extension transport

Connect `ws://127.0.0.1:9224/extension`. Browser Origin must be `chrome-extension://<id>`; non-browser test clients may omit Origin. First message within 5s: `{type:'hello',protocol:2,token,instanceId,browser:'Microsoft Edge',version:'2.0.0'}`. The persistent instanceId is a UUID stored in extension local storage. Reply `{type:'welcome',protocol:2,daemonId}` or close. daemonId is unique per daemon run; a changed value invalidates extension ownership mirrors. A newer authenticated connection replaces only the same instanceId. Old pending commands fail; replies must belong to their originating socket.

Daemon sends `{type:'command',id,action,tabId?,args,session:{id,client,label?}}`. Extension replies `{type:'result',id,ok:true,result}` or `{type:'result',id,ok:false,error:{code,message}}`. Daemon can send `{type:'cancel',id}`. Ping/pong JSON messages keep the MV3 service worker alive. Extension serializes tab actions and honors cancellation during waits; daemon also serializes operations and checks ownership when executing the queue.

Extension actions match public actions except `status` and `session_close` are daemon-local. `tabs` returns an array of `{id,url,title,active,windowId,groupId}`. `open` returns one such tab. Core wraps numeric IDs as handles. `claim`/`open` group tabs using client/session labels. `release` detaches and ungroups. Extension events use `{type:'event',event:'tab_closed',tabId}` or `{type:'event',event:'detached',tabId,reason}`. Tab close removes ownership. User debugger detach revokes ownership so another command cannot immediately reattach silently.

## Adapters

Core client exports `BridgeClient`, `ensureDaemon`, `getSettings` from `core/client.mjs`. Construct `new BridgeClient({client,sessionId?,autoStart?:true})`; use `call(action,args,{signal}?)`, `close()` (session release), and `status()`. Both adapters use one shared tool catalog in `core/tools.mjs`: `tools` array entries `{name,description,inputSchema,action}` and `callTool(client,name,args,options?)` returning standard MCP `content` blocks (real image blocks for screenshots). DSH registers via rc.3 `createMcpToolDefinition`; Antigravity uses stdio MCP. Each MCP process has its own session. The DSH adapter binds clients to the actual DSH agent/session context, never one global session.

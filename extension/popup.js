const $ = id => document.getElementById(id);
let initial = true;
async function request(message) {
  const response = await chrome.runtime.sendMessage(message);
  if (!response?.ok) throw new Error(response?.error?.message || '扩展未响应，请重新加载扩展。');
  return response.result;
}
async function update() {
  try {
    const state = await request({ type: 'status' });
    $('state').textContent = state.connected ? '已连接' : !state.enabled ? '已暂停' : state.paired ? '等待本地服务' : '尚未配对';
    $('statusBox').classList.toggle('online', state.connected);
    $('description').textContent = state.status;
    $('instance').textContent = state.instanceId;
    $('sessionCount').textContent = `受控标签页：${state.tabs.length}`;
    $('sessionList').replaceChildren(...state.tabs.map(tab => {
      const item = document.createElement('li');
      item.textContent = `${tab.client} · ${tab.sessionId.slice(0, 8)} · 标签 ${tab.tabId}`;
      return item;
    }));
    if (initial) { $('port').value = state.port; initial = false; }
    $('pairHint').textContent = state.paired ? '已保存配对令牌。留空可继续使用；粘贴新令牌可重新配对。' : '从本地 bridge 的配对命令复制令牌。每个浏览器 profile 只需配对一次。';
  } catch (error) { $('message').textContent = error.message; }
}
async function busy(callback) {
  $('message').textContent = '';
  $('connect').disabled = $('release').disabled = true;
  try { await callback(); await update(); }
  catch (error) { $('message').textContent = error.message; }
  finally { $('connect').disabled = $('release').disabled = false; }
}
$('pairForm').addEventListener('submit', event => {
  event.preventDefault();
  void busy(async () => {
    await request({ type: 'configure', port: Number($('port').value), token: $('token').value.trim() });
    $('token').value = '';
  });
});
$('release').addEventListener('click', () => void busy(() => request({ type: 'release_all' })));
void update();
setInterval(update, 1500);

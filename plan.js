// The planner shares Dash's stored notes, sync status and login screen flow.
function refreshView() {}

function showPlannerScreen(state) {
  const login = state?.view === 'login';
  $('login').hidden = !login;
  $('planner').hidden = login;
  if (login) $('email').focus();
}

function go(state) {
  history.pushState(state, '');
  showPlannerScreen(state);
}

$('login-back').addEventListener('click', () => history.back());
window.addEventListener('popstate', (event) => showPlannerScreen(event.state));
showPlannerScreen(history.state);
showStatus();
sync();
navigator.storage?.persist?.();
navigator.serviceWorker?.register('sw.js');

// ---------- login ----------
// Email one-time code: Supabase emails a code, and entering it returns a session.

let loginEmail = '';

function loginMessage(text) {
  $('login-msg').textContent = text;
}

function loginError(err) {
  return err instanceof HttpError ? err.message : 'No internet connection.';
}

$('login-btn').addEventListener('click', () => {
  if (auth) {
    if (confirm(`Log out ${auth.user.email}? Your notes stay on this device.`)) logOut();
    return;
  }
  $('code-form').hidden = true;
  loginMessage('');
  go({ view: 'login' });
});

$('email-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  loginEmail = $('email').value.trim();
  loginMessage('Sending code…');
  try {
    await authRequest('otp', { email: loginEmail, create_user: false });
    $('code-sent').textContent = `Code sent to ${loginEmail}. Check your email.`;
    $('code').value = '';
    $('code-form').hidden = false;
    loginMessage('');
  } catch (err) {
    loginMessage(loginError(err));
  }
});

$('code-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  loginMessage('Checking code…');
  try {
    saveSession(await authRequest('verify', { type: 'email', email: loginEmail, token: $('code').value.trim() }));
  } catch (err) {
    loginMessage(loginError(err));
    return;
  }
  // Upload everything on this device once; the server keeps whichever side is newer.
  for (const x of [...data.categories, ...data.entries]) x.dirty = true;
  persist();
  localStorage.removeItem(SYNC_KEY);
  logoutReason = null;
  history.back();
  sync();
});

// Sync when the app opens, comes back to the foreground, or gets a connection.
window.addEventListener('online', sync);
window.addEventListener('offline', showStatus);
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') sync();
});

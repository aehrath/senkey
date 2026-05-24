const params = new URLSearchParams(location.search);
const reason = params.get('reason');
const note = document.getElementById('installNote');

if (note && reason === 'install') {
  note.textContent = 'Welcome to SenKey. Complete the setup steps below before trying to save or fill credentials.';
} else if (note && reason === 'update') {
  note.textContent = 'SenKey was updated. This page is a quick refresher on setup and daily use.';
} else if (note && reason === 'help') {
  note.textContent = 'You opened this page from the SenKey Help button. Use it any time you want a quick refresher.';
}

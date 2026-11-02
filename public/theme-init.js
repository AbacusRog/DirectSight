// Sets the theme before the first paint so there is no flash of the wrong one.
// Kept as a separate file so the page can forbid inline scripts (see public/_headers).
try {
  var t = localStorage.getItem('theme')
  if (t === 'dark' || (!t && matchMedia('(prefers-color-scheme: dark)').matches)) document.documentElement.classList.add('dark')
} catch (e) {}

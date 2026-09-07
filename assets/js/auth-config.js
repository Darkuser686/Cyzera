/* ============================================================
   CYZERA — admin login

     username: Cyzera_Admin
     password: (not written down anywhere — ask the club secretary)

   Only a SHA-256 hash of the password is stored below, never the password
   itself, so this file can live in a public repository. To change the login,
   sign in and open Admin → Settings: it generates a new hash line for you to
   paste over ADMIN_HASH.

   Be clear-eyed about what this is. The site has no server, so the check
   happens in the browser — anyone who opens devtools can see this file and
   work around it. It keeps the panel out of a casual visitor's way; it is not
   a lock. Nothing sensitive lives behind it: the worst an intruder could do is
   change the registration links shown on their own screen, because publishing
   for real means committing assets/js/data.js.
   ============================================================ */

window.CYZERA_AUTH = {
  SALT: 'cyzera::v2',
  ADMIN_HASH: '609bfdd30e20206905adb4f0d4b02e37be945b7ca7c424a18e73a31faaed639f',

  /* Minutes of inactivity before the admin is signed out again. */
  SESSION_MINUTES: 120
};

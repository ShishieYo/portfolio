/**
 * Backend for the portfolio contact form (index.html #contactForm).
 *
 * Deploy as a Web App:
 *   Extensions > Apps Script > paste this file as Code.gs
 *   Deploy > New deployment > type: Web app
 *     Execute as:   Me
 *     Who has access: Anyone
 *   Copy the /exec URL into index.html's <form action="...">
 *
 * After any edit to this file, the live /exec URL does NOT update on its
 * own — you must Deploy > Manage deployments > (edit) > Version: New
 * version > Deploy, or the form keeps hitting the old code.
 */

var NOTIFY_EMAIL = 'jerreldromulo@gmail.com'; // where form submissions are sent

function doPost(e) {
  try {
    var params = (e && e.parameter) || {};
    var name = sanitize_(params.name);
    var email = sanitize_(params.email);
    var message = sanitize_(params.message);

    if (!name || !email || !message) {
      return jsonResponse_({ ok: false, error: 'Missing required field' });
    }

    var subject = 'Portfolio contact: ' + name;
    var body =
      'New message from the portfolio contact form.\n\n' +
      'Name: ' + name + '\n' +
      'Email: ' + email + '\n\n' +
      'Message:\n' + message;

    MailApp.sendEmail({
      to: NOTIFY_EMAIL,
      replyTo: email,
      subject: subject,
      body: body
    });

    return jsonResponse_({ ok: true });
  } catch (err) {
    return jsonResponse_({ ok: false, error: String(err) });
  }
}

// Visiting the /exec URL directly (GET) confirms the deployment is live.
function doGet() {
  return jsonResponse_({ ok: true, message: 'Contact form backend is live.' });
}

function sanitize_(value) {
  return (value || '').toString().trim().slice(0, 5000);
}

function jsonResponse_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

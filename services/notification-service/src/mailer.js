const nodemailer = require('nodemailer');
function createMailer({ host, port, from = 'WorkSphere <no-reply@worksphere.local>' }) {
  if (!host) return null;
  const transport = nodemailer.createTransport({ host, port: Number(port || 1025), secure: false, tls: { rejectUnauthorized: false } });
  return { send: ({ to, subject, text }) => transport.sendMail({ from, to, subject, text }) };
}
const inviteEmailSender = (mailer, appUrl) => async (e) => {
  if (!mailer) return;
  const link = `${appUrl}/accept-invite?token=${e.payload.inviteToken || ''}`;
  await mailer.send({ to: e.payload.email, subject: 'You have been invited to WorkSphere', text: `You were invited as ${e.payload.role}.\nAccept: ${link}\nThis link expires in 72 hours.` });
};
module.exports = { createMailer, inviteEmailSender };

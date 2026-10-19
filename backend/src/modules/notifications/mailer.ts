import type { FastifyBaseLogger } from 'fastify';
import nodemailer from 'nodemailer';
import type { Config } from '../../config.js';

export interface MailMessage {
  to: string;
  subject: string;
  text: string;
  html: string;
}

export interface Mailer {
  send(message: MailMessage): Promise<void>;
}

/** Envoi SMTP (Mailpit en local, ou le serveur SMTP de ton hébergeur / Brevo / Mailgun en production). */
class SmtpMailer implements Mailer {
  private transport;
  constructor(url: string, private from: string) {
    this.transport = nodemailer.createTransport(url);
  }
  async send(m: MailMessage) {
    await this.transport.sendMail({ from: this.from, to: m.to, subject: m.subject, text: m.text, html: m.html });
  }
}

/** Sans SMTP configuré : l'e-mail est écrit dans les logs (pratique en développement). */
class LogMailer implements Mailer {
  constructor(private log: FastifyBaseLogger) {}
  async send(m: MailMessage) {
    this.log.info({ to: m.to, subject: m.subject }, `E-MAIL (non envoyé, SMTP_URL vide)\n${m.text}`);
  }
}

/** Pour les tests : garde les e-mails en mémoire. */
export class MemoryMailer implements Mailer {
  messages: MailMessage[] = [];
  async send(m: MailMessage) {
    this.messages.push(m);
  }
  lastTo(to: string) {
    return [...this.messages].reverse().find((m) => m.to === to);
  }
}

export function createMailer(config: Pick<Config, 'SMTP_URL' | 'MAIL_FROM'>, log: FastifyBaseLogger): Mailer {
  return config.SMTP_URL ? new SmtpMailer(config.SMTP_URL, config.MAIL_FROM) : new LogMailer(log);
}

/**
 * Envoi en arrière-plan : un e-mail qui échoue ne doit pas faire échouer l'action de l'utilisateur
 * (il pourra redemander un code). L'erreur est journalisée.
 */
export function sendInBackground(mailer: Mailer, log: FastifyBaseLogger, message: MailMessage) {
  mailer.send(message).catch((err) => log.error({ err, to: message.to, subject: message.subject }, 'échec envoi e-mail'));
}

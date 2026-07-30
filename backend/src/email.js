import { Resend } from "resend";

const resend = new Resend(process.env.RESEND_API_KEY);

// Mittente di default fornito da Resend per account senza dominio verificato.
// Quando sarà disponibile un dominio proprio, basterà impostare EMAIL_MITTENTE
// (es. "Commexa <no-reply@tuodominio.it>") senza toccare altro codice.
const MITTENTE = process.env.EMAIL_MITTENTE || "Commexa <onboarding@resend.dev>";

export async function inviaEmailResetPassword(email, link) {
  await resend.emails.send({
    from: MITTENTE,
    to: email,
    subject: "Reimposta la tua password — Commexa",
    text:
      "Hai richiesto di reimpostare la password del tuo account Commexa.\n\n" +
      `Apri questo link entro un'ora per scegliere una nuova password:\n${link}\n\n` +
      "Se non hai richiesto tu il reset, ignora questa email: la tua password resterà invariata.",
    html: `
      <div style="font-family:Arial,sans-serif;color:#22262E;max-width:480px;margin:0 auto;">
        <p style="font-size:16px;">Hai richiesto di reimpostare la password del tuo account <strong>Commexa</strong>.</p>
        <p style="font-size:16px;">Apri questo link entro <strong>un'ora</strong> per scegliere una nuova password:</p>
        <p style="margin:24px 0;">
          <a href="${link}" style="background:#9A783A;color:#fff;padding:12px 20px;border-radius:8px;text-decoration:none;font-weight:600;display:inline-block;">
            Reimposta la password
          </a>
        </p>
        <p style="font-size:13px;color:#7A7F87;">Se il pulsante non funziona, copia questo link nel browser:<br>${link}</p>
        <p style="font-size:13px;color:#7A7F87;">Se non hai richiesto tu il reset, ignora questa email: la tua password resterà invariata.</p>
      </div>
    `,
  });
}

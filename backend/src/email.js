import { Resend } from "resend";
import { componiAvviso } from "./avvisiProva.js";

const resend = new Resend(process.env.RESEND_API_KEY);

// Mittente di default fornito da Resend per account senza dominio verificato.
// Quando sarà disponibile un dominio proprio, basterà impostare EMAIL_MITTENTE
// (es. "Commexa <no-reply@tuodominio.it>") senza toccare altro codice.
const MITTENTE = process.env.EMAIL_MITTENTE || "Commexa <onboarding@resend.dev>";

/**
 * Il dominio sotto cui si firmano le radici di conversazione.
 *
 * Viene dal mittente VERO, e non da una costante scritta qui: un identificatore
 * di messaggio si scrive sotto il dominio di chi manda, e il giorno che
 * EMAIL_MITTENTE passa a un dominio proprio le radici lo seguono da sole. Il
 * ripiego serve solo a non produrre mai un `References` malformato: un header
 * storto è peggio di un header assente, perché un client che non lo capisce può
 * decidere da sé dove mettere il messaggio.
 */
const DOMINIO_MITTENTE = MITTENTE.match(/@([^>\s]+)/)?.[1]?.toLowerCase() || "commexa.local";

/**
 * Spedisce, E SI ACCORGE SE NON È PARTITA.
 *
 * IL CLIENT DI RESEND NON SOLLEVA UN ERRORE quando l'API rifiuta la richiesta:
 * restituisce `{ data, error }` e prosegue tranquillo. Chiamarlo senza
 * guardare `error` significa che una chiave sbagliata, un mittente non
 * verificato, un destinatario rifiutato o una quota finita risultano tutti
 * «email mandata».
 *
 * Non è un dettaglio difensivo, è il guasto peggiore di questo file. Per gli
 * avvisi di scadenza vorrebbe dire segnare l'avviso come chiuso senza averlo
 * mandato — e quegli avvisi sono tre e poi mai più, quindi non ci sarebbe una
 * seconda occasione. Per il reset password vorrebbe dire dire all'utente
 * «controlla la posta» sapendo che non arriverà niente.
 *
 * Trovato in collaudo, con una chiave di prova finta: il giro ha riferito
 * «3 mandati, 0 falliti» senza che partisse niente.
 */
async function spedisci(messaggio) {
  const risposta = await resend.emails.send(messaggio);
  const errore = risposta?.error;
  if (errore) {
    throw new Error(`Resend ha rifiutato l'invio: ${errore.message || JSON.stringify(errore)}`);
  }
  return risposta?.data;
}

/**
 * Manda uno dei tre avvisi sulla scadenza della prova.
 *
 * QUI NON SI DECIDE NIENTE: chi riceve, quale dei tre e cosa c'è scritto lo
 * stabilisce avvisiProva.js, che è puro e si può leggere per intero in una
 * prova senza chiave di Resend. Questa funzione sa solo spedire — e se un
 * giorno il testo andasse cambiato, il posto è là, dove ci sono le prove che
 * lo guardano.
 *
 * Lascia salire l'errore invece di ingoiarlo: chi chiama deve poter riaprire
 * l'avviso e riprovare al giro dopo. Un'email persa in silenzio è il guasto
 * peggiore che questa funzione possa produrre.
 */
export async function inviaAvvisoProva(email, tipo, fineProva, link) {
  const messaggio = componiAvviso(tipo, fineProva, link);
  if (!messaggio) throw new Error(`Tipo di avviso sconosciuto: ${tipo}`);
  /* DOVE SI POSA NELLA POSTA. Quale dei tre si accorpa e quale sta da solo lo
     decide avvisiProva.js insieme al testo, perché è la stessa domanda — come
     si presenta questo messaggio a chi lo riceve. Qui si traduce e basta: chi
     ha una conversazione porta il `References` che lo unisce agli altri, chi
     non ce l'ha non porta niente, e non avere l'header è precisamente ciò che
     lo tiene fuori da ogni conversazione. */
  const conversazione = messaggio.conversazione;
  await spedisci({
    from: MITTENTE,
    to: email,
    subject: messaggio.oggetto,
    text: messaggio.testo,
    html: messaggio.html,
    ...(conversazione ? { headers: { References: `<${conversazione}@${DOMINIO_MITTENTE}>` } } : {}),
  });
}

export async function inviaEmailResetPassword(email, link) {
  await spedisci({
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
          <!-- Bronzo #8A6D4B: lo stesso del marchio, non un bronzo diverso.
               Prima qui c'era #9A783A, nato prima che l'accento fosse fissato e
               mai riconciliato. Su fondo bianco con testo bianco fa 4,81:1,
               quindi si allinea senza perdere leggibilita'. Il raggio resta 8px
               come i controlli dell'app. -->
          <a href="${link}" style="background:#8A6D4B;color:#fff;padding:12px 20px;border-radius:8px;text-decoration:none;font-weight:600;display:inline-block;">
            Reimposta la password
          </a>
        </p>
        <p style="font-size:13px;color:#7A7F87;">Se il pulsante non funziona, copia questo link nel browser:<br>${link}</p>
        <p style="font-size:13px;color:#7A7F87;">Se non hai richiesto tu il reset, ignora questa email: la tua password resterà invariata.</p>
      </div>
    `,
  });
}

import nodemailer from "npm:nodemailer@8.0.9";

const recipient = "sharework.reg@liveasta.it";

Deno.serve(async (request) => {
  if (request.method !== "POST") return new Response(null, { status: 405 });
  const token = request.headers.get("x-sharework-token");
  if (!token || !/^[0-9a-f]{64}$/.test(token)) return new Response(null, { status: 403 });

  try {
    const { id } = await request.json();
    if (typeof id !== "string" || !/^[0-9a-f-]{36}$/i.test(id)) return new Response(null, { status: 400 });
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const projectUrl = Deno.env.get("SUPABASE_URL");
    const response = await fetch(projectUrl + "/rest/v1/rpc/sw_registration_mail_config", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        apikey: serviceKey!,
        authorization: "Bearer " + serviceKey,
      },
      body: JSON.stringify({ registration_id: id, webhook_token: token }),
    });
    if (!response.ok) return new Response(null, { status: 502 });
    const [account] = await response.json();
    if (!account) return new Response(null, { status: 403 });

    const mail = nodemailer.createTransport({
      host: "smtps.aruba.it",
      port: 465,
      secure: true,
      connectionTimeout: 7000,
      greetingTimeout: 7000,
      socketTimeout: 14000,
      auth: { user: account.smtp_user, pass: account.smtp_password },
    });
    await mail.sendMail({
      from: { name: "Sharework Registration", address: account.smtp_user },
      to: recipient,
      subject: "Sharework · Nuova registrazione",
      text: "Un nuovo utente si è registrato su Sharework.\n\nNome e cognome: " +
        account.full_name + "\nEmail: " + account.email +
        "\n\nApri Sharework e vai in Utenti per gestire l’approvazione.",
    });
    return new Response(null, { status: 204 });
  } catch {
    console.error("Sharework registration alert failed");
    return new Response(null, { status: 502 });
  }
});
